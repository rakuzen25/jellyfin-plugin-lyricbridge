/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
import { directChildByClass, removeNode, replaceChildren } from "./dom.ts";
import type { AnimatedWord, MotionGlyph } from "./karaoke-animation.ts";
import { clamp01 } from "./motion.ts";
import type { TextRange } from "./text-processing.ts";
import { getGraphemeRanges } from "./text-processing.ts";
export interface GeometryWord extends AnimatedWord {
    text: string;
    isRtl: boolean;
    _motionDurationProgress?: number;
    geometryReady?: boolean;
    renderWidth?: number;
    geometrySource?: string;
}
interface GlyphBox {
    left: number;
    top: number;
    width: number;
    height: number;
}
interface GeometryPolicy {
    visibleWordLength(word: GeometryWord): number;
    canUseGraphemeMotionOverlay(word: GeometryWord): boolean;
    shouldUsePerGlyphMotion(count: number): boolean;
}
export const BASE_WIPE_GRADIENT_EM = 0.75;
const LONG_WORD_WIPE_EXTRA_EM = 0.45;

export function createWordGeometry({ visibleWordLength, canUseGraphemeMotionOverlay, shouldUsePerGlyphMotion }: GeometryPolicy) {
    function getPrefixWidth(textNode: Text | null, offset: number) {
        if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return 0;

        const range = document.createRange();

        try {
            range.setStart(textNode!, 0);
            range.setEnd(textNode!, Math.max(0, Math.min(offset, textNode.length)));
            return range.getBoundingClientRect().width;
        } catch {
            return 0;
        } finally {
            if (range.detach) range.detach();
        }
    }

    function computeGlyphMotionMetrics(word: GeometryWord, glyphIndex: number, glyphCount: number) {
        const durationMs = word.motionDurationMs;
        const durationProgress = word._motionDurationProgress || 0;

        const isLongWord = glyphCount > 5;
        const isShortDuration = durationMs < 1200;

        let maxDecayRate = 0;

        if (isLongWord || isShortDuration) {
            let decayStrength = 0;

            if (isLongWord) {
                decayStrength += Math.min((glyphCount - 5) / 5, 1) * 0.4;
            }

            if (isShortDuration && glyphCount > 3) {
                decayStrength += Math.max(0, 1 - (durationMs - 800) / 400) * 0.3;
            } else if (isShortDuration && glyphCount <= 3) {
                decayStrength += Math.max(0, 1 - (durationMs - 800) / 400) * 0.1;
            }

            maxDecayRate = Math.min(decayStrength, 0.7);
        }

        const positionInWord = glyphCount > 1 ? glyphIndex / (glyphCount - 1) : 0;

        const decayFactor = 1 - positionInWord * maxDecayRate;

        const charProgress = durationProgress * decayFactor;

        const baseGrowth = glyphCount <= 3 ? 0.05 : 0.04;

        const maxScale = 1 + baseGrowth + charProgress * 0.08;

        const glowDurFactor = Math.min(1.1, durationMs / 1500);

        let glowLenFactor = 1;

        if (glyphCount <= 3) {
            glowLenFactor = 0.85;
        } else if (glyphCount >= 6) {
            glowLenFactor = 1.1;
        }

        const shadowIntensity = (0.35 + charProgress * 0.45) * glowDurFactor * glowLenFactor;

        const normalizedGrowth = (maxScale - 1) / 0.1;

        const peakMultiplier = Math.min(1, Math.max(0.3, durationMs / 2000));

        const peakYEm = -0.0625 * normalizedGrowth * peakMultiplier;

        const position = (glyphIndex + 0.5) / glyphCount;

        const offsetXEm = (position - 0.5) * 2 * ((maxScale - 1) * 0.36);

        return {
            maxScale: maxScale * 0.98,
            shadowIntensity,
            peakYEm,
            offsetXEm: offsetXEm * 0.98,
        };
    }

    function clearMotionLayer(word: GeometryWord) {
        if (!word || !word.element) return;

        const layer = directChildByClass(word.element, "ak-motion-layer");
        removeNode(layer);

        word.element.classList.remove("ak-motion-per-glyph", "ak-motion-whole");

        /* Geometry/profile changes may switch whole-word and glyph paths. */
        word.element.style.transform = "";
        word.element.style.filter = "";
        word._akWholeFilterCleared = false;

        word.motionGlyphs = [];
        word.wholeMotion = null;
        word.geometryReady = false;
        word.renderWidth = 0;
        (word.segments || []).forEach((segment) => {
            delete segment.visualStart;
            delete segment.visualEnd;
        });
        word.geometrySource = "unprepared";
    }

    function createMotionGlyph(word: GeometryWord, rangeInfo: TextRange, index: number, glyphCount: number, box: GlyphBox) {
        const glyph: MotionGlyph = document.createElement("span");
        glyph.className = "ak-motion-glyph";

        glyph.glowLayers = ["ak-glow-core", "ak-glow-halo"].map((className) => {
            const glow = document.createElement("span");
            glow.className = "ak-glow-layer " + "ak-glyph-glow-layer " + className;
            glow.textContent = rangeInfo.text;
            glow.style.opacity = "0";
            glyph.appendChild(glow);
            return glow;
        });

        glyph.style.left = `${box.left.toFixed(3)}px`;
        glyph.style.top = `${box.top.toFixed(3)}px`;
        glyph.style.width = `${box.width.toFixed(3)}px`;
        glyph.style.height = `${box.height.toFixed(3)}px`;
        glyph._akMotion = computeGlyphMotionMetrics(word, index, glyphCount);

        return glyph;
    }

    function measuredFallbackGlyphBoxes(word: GeometryWord, graphemes: TextRange[], wordRect: { width: number; height: number }) {
        const widths: number[] = [];
        let measuredTotal = 0;

        try {
            const canvas = document.createElement("canvas");
            const context = canvas.getContext("2d");
            const style = window.getComputedStyle(word.element!);

            if (context) {
                context.font = style.font || [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily].join(" ");

                graphemes.forEach((rangeInfo) => {
                    const width = Math.max(0.001, context.measureText(rangeInfo.text).width);
                    widths.push(width);
                    measuredTotal += width;
                });
            }
        } catch {
            // Equal-width fallback below is deterministic and compositor-safe.
        }

        if (widths.length !== graphemes.length || measuredTotal <= 0) {
            widths.length = 0;
            graphemes.forEach(() => widths.push(1));
            measuredTotal = graphemes.length;
        }

        const scale = wordRect.width / measuredTotal;
        let cursor = 0;

        return widths.map((width) => {
            const scaledWidth = width * scale;
            const logicalLeft = cursor;
            cursor += scaledWidth;

            return {
                left: word.isRtl ? wordRect.width - logicalLeft - scaledWidth : logicalLeft,
                top: 0,
                width: scaledWidth,
                height: wordRect.height,
            };
        });
    }

    function prepareWordGeometry(word: GeometryWord) {
        if (!word || !word.element || !word.segments.length) return;

        clearMotionLayer(word);

        let textNode: Text | null = null;
        const childNodes = word.element.childNodes || [];
        for (let index = 0; index < childNodes.length; index += 1) {
            if (childNodes[index]!.nodeType === Node.TEXT_NODE) {
                textNode = childNodes[index] as Text;
                break;
            }
        }

        if (!textNode) return;

        const wordRect = word.element.getBoundingClientRect();

        /* Adjacent cue segments share boundaries. Cache prefix Range reads so
         * a boundary used as one cue's end and the next cue's start is measured
         * once rather than forcing duplicate layout work. */
        const prefixWidths = new Map<number, number>();
        const prefixWidth = (position: number) => {
            const safePosition = Math.max(0, Math.min(textNode!.length, Number(position) || 0));
            if (prefixWidths.has(safePosition)) {
                return prefixWidths.get(safePosition)!;
            }
            const measured = getPrefixWidth(textNode, safePosition);
            prefixWidths.set(safePosition, measured);
            return measured;
        };

        const fullWidth = prefixWidth(textNode.length);

        /* Do not manufacture Range geometry from the word's box when Range
         * measurement failed. A zero-width prefix combined with a non-zero
         * box maps every segment to 0% and makes the sweep appear only at the
         * final frame. Leaving visual bounds unset intentionally uses the
         * reliable source-character fallback in wordTargetProgress(). */
        if (Number.isFinite(fullWidth) && fullWidth > 0) {
            const measuredSegments = word.segments.map((segment) => ({
                segment,
                start: prefixWidth(segment.startPos),
                end: prefixWidth(segment.endPos),
            }));
            const valid = measuredSegments.every(
                (entry) =>
                    Number.isFinite(entry.start) &&
                    Number.isFinite(entry.end) &&
                    entry.end > entry.start &&
                    entry.start >= 0 &&
                    entry.end <= fullWidth + 0.5,
            );

            if (valid) {
                word.renderWidth = fullWidth;
                measuredSegments.forEach((entry) => {
                    entry.segment.visualStart = clamp01(entry.start / fullWidth);
                    entry.segment.visualEnd = clamp01(entry.end / fullWidth);
                });
                word.geometryReady = true;
            }
        }

        const glyphCount = Math.max(1, visibleWordLength(word));

        const extra = clamp01((glyphCount - 6) / 10) * LONG_WORD_WIPE_EXTRA_EM;

        const wipeWidth = BASE_WIPE_GRADIENT_EM + extra;

        word.element.style.setProperty("--ak-wipe-half", `${(wipeWidth / 2).toFixed(3)}em`);

        if (word.motionMode !== "grow") {
            return;
        }

        /*
         * Segment-safe scripts can use a per-grapheme motion overlay that
         * mirrors the staggered character glow. Contextual scripts keep their
         * original shaped word and receive the same whole-word bloom/motion.
         */
        if (!canUseGraphemeMotionOverlay(word) || !shouldUsePerGlyphMotion(glyphCount)) {
            word.element.classList.add("ak-motion-whole");
            word.wholeMotion = computeGlyphMotionMetrics(word, Math.floor(glyphCount / 2), glyphCount);
            word.geometrySource = "whole-joining-or-profile";
            return;
        }

        if (!wordRect.width || !wordRect.height) {
            word.element.classList.add("ak-motion-whole");
            word.wholeMotion = computeGlyphMotionMetrics(word, Math.floor(glyphCount / 2), glyphCount);
            word.geometrySource = "whole-no-box";
            return;
        }

        const graphemes = getGraphemeRanges(word.text).filter((range) => /\S/u.test(range.text));

        if (!graphemes.length) return;

        const layer = document.createElement("span");

        layer.className = "ak-motion-layer";
        layer.setAttribute("aria-hidden", "true");

        const glyphs: MotionGlyph[] = [];
        const layoutWidth = Number(word.element.offsetWidth);
        const layoutHeight = Number(word.element.offsetHeight);
        const scaleX = Number.isFinite(layoutWidth) && layoutWidth > 0 ? wordRect.width / layoutWidth : 1;
        const scaleY = Number.isFinite(layoutHeight) && layoutHeight > 0 ? wordRect.height / layoutHeight : 1;
        const usableScaleX = Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1;
        const usableScaleY = Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1;
        const localWordRect = {
            width: wordRect.width / usableScaleX,
            height: wordRect.height / usableScaleY,
        };

        graphemes.forEach((rangeInfo, index) => {
            const range = document.createRange();

            try {
                range.setStart(textNode!, rangeInfo.start);
                range.setEnd(textNode!, rangeInfo.end);

                const rect = range.getBoundingClientRect();

                if (!rect.width && !rect.height) return;

                const glyph = createMotionGlyph(word, rangeInfo, index, graphemes.length, {
                    /* Range rectangles are viewport-space and include the
                     * line/word scale. Glyph overlays are children of the
                     * already-transformed word, so convert them back to
                     * local coordinates instead of applying that scale a
                     * second time. */
                    left: (rect.left - wordRect.left) / usableScaleX,
                    top: (rect.top - wordRect.top) / usableScaleY,
                    width: rect.width / usableScaleX,
                    height: rect.height / usableScaleY,
                });

                layer.appendChild(glyph);
                glyphs.push(glyph);
            } catch {
                // Ignore one failed glyph and preserve the base word.
            } finally {
                if (range.detach) range.detach();
            }
        });

        if (glyphs.length !== graphemes.length) {
            replaceChildren(layer);
            glyphs.length = 0;

            measuredFallbackGlyphBoxes(word, graphemes, localWordRect).forEach((box, index) => {
                const glyph = createMotionGlyph(word, graphemes[index]!, index, graphemes.length, box);
                layer.appendChild(glyph);
                glyphs.push(glyph);
            });

            word.geometrySource = "canvas-fallback";
        } else {
            word.geometrySource = "range";
        }

        if (glyphs.length === graphemes.length) {
            word.element.appendChild(layer);
            word.motionGlyphs = glyphs;
            word.element.classList.add("ak-motion-per-glyph");
        } else {
            word.element.classList.add("ak-motion-whole");
            word.wholeMotion = computeGlyphMotionMetrics(word, Math.floor(glyphCount / 2), glyphCount);
            word.geometrySource = "whole-geometry-failure";
        }
    }

    return { prepareWordGeometry };
}
