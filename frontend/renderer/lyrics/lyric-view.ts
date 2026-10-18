import { DECORATION_RETRY_MS, DECORATION_RETRY_WINDOW_MS, TICKS_PER_SECOND } from "../common/settings.ts";
import type { HostInstallationStatePort } from "../host/ports.ts";
import type { PronunciationStatePort } from "../pronunciation/ports.ts";
import type { LyricSessionStatePort } from "./session-ports.ts";
/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
import { requireValue } from "../../shared/invariants.ts";

import type { Lifecycle } from "../../shared/lifecycle.ts";
import { replaceChildren } from "../common/dom.ts";
import { getCurrentLyricsContainer, isLyricsPage } from "../host/host.ts";
import { finiteTick } from "../playback/ticks.ts";
import { detectScriptProfile, firstStrongDirection, getGraphemeBoundaries, snapBoundary } from "../pronunciation/text-processing.ts";
import type { CueInput } from "./cue-ranges.ts";
import { orderedCuesBySourcePosition } from "./cue-ranges.ts";
import type { CueRecord, RenderGap, RenderLine, RenderWord } from "./models.ts";
import type { LyricInput } from "./payload.ts";
import { cueValue, hasUsableWordTiming, lyricTextProfile, usableWordCueRanges } from "./payload.ts";
function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

interface Dependencies {
    displayLyricForCurrentMode: (lyric: LyricInput) => LyricInput;
    lyricsPort: LyricSessionStatePort;
    hostPort: HostInstallationStatePort;
    pronunciationPort: PronunciationStatePort;
    createUntimedSpan: (text: string) => HTMLSpanElement | null | undefined;
    calculateLineBounds: (
        lyric: LyricInput,
        lineIndex: number,
        words: RenderWord[],
        cues: CueInput[],
        rawTextLength: number,
    ) => { startTicks: number; endTicks: number; trustedEndTicks: number | null };
    cueEndTicks: (lineIndex: number, cueIndex: number, cue: CueInput, cues: (CueRecord | CueInput)[]) => number;
    buildWordRecords: (text: string, lineIndex: number, cueRecords: CueRecord[]) => RenderWord[];
    classifyWordMotion: (words: RenderWord[]) => void;
    createWordSpan: (word: RenderWord) => HTMLSpanElement;
    lifecycle: Lifecycle;
    stableHash: (input: string) => number;
    removeInstrumentalGapRows: (container?: HTMLElement | null) => void;
    resetMotionHandoffs: () => void;
    invalidateFollowTarget: () => void;
    removeRomanizationToggle: () => void;
    removeTimingControls: () => void;
    stopAnimationLoop: (reason?: string) => string;
    suppressJellyfinLyricAutoFollow: (reason?: string) => boolean;
    yieldLyricsWork: () => Promise<void>;
    installInstrumentalGapRows: (container: HTMLElement | null) => readonly RenderGap[];
    ensureRomanizationToggle: () => HTMLButtonElement | null;
    ensureTimingControls: () => HTMLButtonElement | null;
    applyAccentTheme: () => void;
    applyPerformanceProfile: (refreshGeometry?: boolean) => void;
    queueMotionGeometryRefresh: () => boolean;
    ensureAnimationLoop: () => boolean;
    warn: (...args: unknown[]) => void;
}
export function createLyricView(dependencies: Dependencies) {
    const {
        displayLyricForCurrentMode,
        lyricsPort,
        hostPort,
        pronunciationPort,
        createUntimedSpan,
        calculateLineBounds,
        cueEndTicks,
        buildWordRecords,
        classifyWordMotion,
        createWordSpan,
        lifecycle,
        stableHash,
        removeInstrumentalGapRows,
        resetMotionHandoffs,
        invalidateFollowTarget,
        removeRomanizationToggle,
        removeTimingControls,
        stopAnimationLoop,
        suppressJellyfinLyricAutoFollow,
        yieldLyricsWork,
        installInstrumentalGapRows,
        ensureRomanizationToggle,
        ensureTimingControls,
        applyAccentTheme,
        applyPerformanceProfile,
        queueMotionGeometryRefresh,
        ensureAnimationLoop,
        warn,
    } = dependencies;
    function decorateLine(lineElement: HTMLElement, lyric: LyricInput, lineIndex: number): RenderLine {
        const displayLyric = displayLyricForCurrentMode(lyric);
        const textProfile = lyricTextProfile(displayLyric);
        const rawText = textProfile.rawText;
        const text = textProfile.text;
        const positionOffset = textProfile.positionOffset;
        const isBackgroundVocal = textProfile.isBackgroundVocal;
        const backgroundVocalRoleSource = textProfile.backgroundVocalRoleSource;
        const vocalAgent = textProfile.vocalAgent;
        const vocalKind = textProfile.vocalKind;
        const songSection = textProfile.songSection;
        const rawCues = cueValue(displayLyric, "Cues", "cues");
        const orderedCues = Array.isArray(rawCues) ? orderedCuesBySourcePosition(rawCues) : [];
        const wordCueRanges = usableWordCueRanges(displayLyric, orderedCues);
        const hasWordTiming = hasUsableWordTiming(displayLyric, orderedCues);
        const cues = hasWordTiming ? wordCueRanges.map((range) => range.cue) : [];

        Array.from(lineElement.classList || [])
            .filter((name) => name === "ak-plain-line" || name.indexOf("ak-script-") === 0)
            .forEach((name) => lineElement.classList.remove(name));

        lineElement.style.removeProperty("visibility");
        lineElement.style.removeProperty("--ak-bg-anchor-offset");
        lineElement.removeAttribute("aria-hidden");
        lyricsPort.setRetiredLineElements(
            lyricsPort.snapshot.retiredLineElements.filter((element: HTMLElement) => element && element !== lineElement && element.isConnected),
        );
        lineElement.classList.add("ak-enhanced-line");
        lineElement.classList.remove(
            "ak-current",
            "ak-past",
            "ak-future",
            "ak-near",
            "ak-near2",
            "ak-far",
            "ak-overlap-current",
            "ak-motion-handoff",
        );
        lineElement.dataset.akTimingLineIndex = String(lineIndex);
        lineElement.classList.toggle("ak-line-synced", cues.length === 0);
        lineElement.classList.toggle("ak-background-vocal", isBackgroundVocal);
        lineElement.classList.remove("ak-bg-attached-before", "ak-bg-attached-after", "ak-bg-standalone");
        delete lineElement.dataset.akBackgroundAttachment;
        delete lineElement.dataset.akBackgroundAnchorLine;
        lineElement.classList.remove("ak-has-shaped-script");
        lineElement.classList.remove(
            "ak-vocal-lane-left",
            "ak-vocal-lane-center",
            "ak-vocal-lane-right",
            "ak-vocal-lane-group",
            "ak-vocal-tone-1",
            "ak-vocal-tone-2",
            "ak-vocal-tone-3",
            "ak-vocal-tone-4",
            "ak-vocal-tone-5",
            "ak-vocal-tone-group",
        );
        lineElement.dataset.akGeneration = String(lyricsPort.snapshot.generation);
        lineElement.dataset.akLyricIdentity = lyricDomIdentity(lyric);
        lineElement.dataset.akVocalRole = isBackgroundVocal ? "background" : "main";
        if (backgroundVocalRoleSource) {
            lineElement.dataset.akVocalRoleSource = backgroundVocalRoleSource;
        } else {
            delete lineElement.dataset.akVocalRoleSource;
        }
        if (vocalAgent) {
            lineElement.dataset.akVocalAgent = vocalAgent;
        } else {
            delete lineElement.dataset.akVocalAgent;
        }
        if (vocalKind) {
            lineElement.dataset.akVocalKind = vocalKind;
        } else {
            delete lineElement.dataset.akVocalKind;
        }
        if (songSection) {
            lineElement.dataset.akSongSection = songSection;
        } else {
            delete lineElement.dataset.akSongSection;
        }
        const lineDirection = firstStrongDirection(text);
        lineElement.setAttribute("dir", lineDirection);

        /* Keep screen-reader output in the song's language; vocal role stays data. */
        lineElement.setAttribute("aria-label", text);
        replaceChildren(lineElement);

        if (!cues.length) {
            lineElement.appendChild(requireValue(createUntimedSpan(text)));
            const bounds = calculateLineBounds(displayLyric, lineIndex, [], orderedCues, rawText.length);
            return {
                element: lineElement,
                displayLyric,
                lineIndex,
                text,
                cues: [],
                words: [],
                startTicks: bounds.startTicks,
                endTicks: bounds.endTicks,
                trustedEndTicks: bounds.trustedEndTicks,
                isBackgroundVocal,
                backgroundVocalRoleSource,
                vocalAgent,
                vocalKind,
                songSection,
                ownedText: text,
                ownedNodes: Array.from(lineElement.children || []),
            };
        }

        const graphemeBoundaries = getGraphemeBoundaries(text);

        const cueRecords: CueRecord[] = [];

        wordCueRanges.forEach((range) => {
            const cue = range.cue;
            const sourceCueIndex = range.cueIndex;
            let startPos = range.startPosition;
            let endPos = range.endPosition;

            startPos = Math.max(0, startPos - positionOffset);

            endPos = Math.max(startPos, endPos - positionOffset);

            const start = finiteTick(cueValue(cue, "Start", "start")) ?? 0;

            /* Keep the complete source-ordered cue list here. In particular,
             * the converter intentionally emits a final empty cue at
             * text.length to mark the real end of an ELRC line. That cue does
             * not create a visible word range, but it must still end the last
             * visible word rather than letting its sweep run to the next line. */
            const end = cueEndTicks(lineIndex, sourceCueIndex, cue, orderedCues);

            startPos = snapBoundary(graphemeBoundaries, startPos, "backward");
            endPos = snapBoundary(graphemeBoundaries, endPos, "forward");
            endPos = Math.max(startPos, Math.min(text.length, endPos));

            if (endPos > startPos) {
                const record = {
                    cue,
                    cueIndex: sourceCueIndex,
                    startPos,
                    endPos,
                    start,
                    end,
                    sourceCueIndexes: [sourceCueIndex],
                };

                const previous = cueRecords[cueRecords.length - 1];

                if (previous && record.startPos < previous.endPos) {
                    previous.endPos = Math.max(previous.endPos, record.endPos);

                    previous.start = Math.min(previous.start, record.start);

                    previous.end = Math.max(previous.end, record.end);

                    requireValue(previous.sourceCueIndexes).push(sourceCueIndex);
                } else {
                    cueRecords.push(record);
                }
            }
        });

        const words = buildWordRecords(text, lineIndex, cueRecords);
        classifyWordMotion(words);

        const hasShapedScript = words.some((word) => word.paintMode === "shaped");

        lineElement.classList.toggle("ak-has-shaped-script", hasShapedScript);

        /*
         * Render exactly one shaped span per source word/token. Space-delimited
         * scripts keep word scope; CJK/Thai/Lao/Khmer/Myanmar can preserve the
         * exact ELRC cue token boundaries when the source provides them.
         * Cue timing remains available as progress segments inside each span.
         */
        let textCursor = 0;

        words.forEach((word) => {
            if (word.startPos > textCursor) {
                lineElement.appendChild(requireValue(createUntimedSpan(text.slice(textCursor, word.startPos))));
            }

            lineElement.appendChild(createWordSpan(word));
            textCursor = word.endPos;
        });

        if (textCursor < text.length) {
            lineElement.appendChild(requireValue(createUntimedSpan(text.slice(textCursor))));
        }

        const bounds = calculateLineBounds(displayLyric, lineIndex, words, orderedCues, rawText.length);

        return {
            element: lineElement,
            displayLyric,
            lineIndex,
            text,
            cues: cueRecords,
            words,
            startTicks: bounds.startTicks,
            endTicks: bounds.endTicks,
            trustedEndTicks: bounds.trustedEndTicks,
            isBackgroundVocal,
            backgroundVocalRoleSource,
            vocalAgent,
            vocalKind,
            songSection,
            ownedText: text,
            ownedNodes: Array.from(lineElement.children || []),
        };
    }

    function backgroundVocalAttachmentFor(lineRecord: RenderLine, lineRecords: readonly RenderLine[]) {
        if (!lineRecord || !lineRecord.isBackgroundVocal) {
            return {
                placement: "standalone",
                anchorLineIndex: null,
            };
        }

        const records = Array.isArray(lineRecords) ? lineRecords : [];
        const currentIndex = records.indexOf(lineRecord);

        if (currentIndex < 0) {
            return {
                placement: "standalone",
                anchorLineIndex: null,
            };
        }

        let previousLead = null;
        let nextLead = null;

        for (let index = currentIndex - 1; index >= 0; index -= 1) {
            if (!requireValue(records[index]).isBackgroundVocal) {
                previousLead = records[index];
                break;
            }
        }

        for (let index = currentIndex + 1; index < records.length; index += 1) {
            if (!requireValue(records[index]).isBackgroundVocal) {
                nextLead = records[index];
                break;
            }
        }

        if (!previousLead && !nextLead) {
            return {
                placement: "standalone",
                anchorLineIndex: null,
            };
        }

        const backgroundStart = Number(lineRecord.startTicks);
        const backgroundEnd = Number(lineRecord.endTicks);
        const affinity = (lead: RenderLine) => {
            const leadStart = Number(lead && lead.startTicks);
            const leadEnd = Number(lead && lead.endTicks);
            const hasIntervals =
                isFiniteNumber(backgroundStart) && isFiniteNumber(backgroundEnd) && isFiniteNumber(leadStart) && isFiniteNumber(leadEnd);
            const overlap = hasIntervals ? Math.max(0, Math.min(backgroundEnd, leadEnd) - Math.max(backgroundStart, leadStart)) : 0;
            const gap = hasIntervals ? (overlap > 0 ? 0 : Math.max(0, backgroundStart - leadEnd, leadStart - backgroundEnd)) : Infinity;

            return {
                sameStart: isFiniteNumber(backgroundStart) && isFiniteNumber(leadStart) && backgroundStart === leadStart,
                overlap,
                gap,
            };
        };

        if (!previousLead) {
            return {
                placement: "before",
                anchorLineIndex: requireValue(nextLead).lineIndex,
            };
        }

        if (!nextLead) {
            return {
                placement: "after",
                anchorLineIndex: previousLead.lineIndex,
            };
        }

        const previousAffinity = affinity(previousLead);
        const nextAffinity = affinity(nextLead);

        /* Exact same-start call/response belongs before the following lead.
         * Otherwise prefer the lead with the longest real overlap, then the
         * smallest silence. This handles backing lines stored either before
         * their lead or immediately after it without letting a tiny next-line
         * overlap steal a response that belongs to the preceding lyric. */
        const useNext =
            (nextAffinity.sameStart && !previousAffinity.sameStart) ||
            (nextAffinity.sameStart === previousAffinity.sameStart &&
                (nextAffinity.overlap > previousAffinity.overlap ||
                    (nextAffinity.overlap === previousAffinity.overlap && nextAffinity.gap < previousAffinity.gap)));

        return useNext
            ? {
                  placement: "before",
                  anchorLineIndex: nextLead.lineIndex,
              }
            : {
                  placement: "after",
                  anchorLineIndex: previousLead.lineIndex,
              };
    }

    function applyVocalLanes(lineRecords: readonly RenderLine[]) {
        /* TTML agent IDs have no inherent screen position. Assign person
         * agents deterministic lanes in source order: a duet is left/right;
         * three or more voices use left/centre/right and cycle thereafter.
         * Group agents stay centred. This keeps call-and-response legible
         * without inventing a singer identity that the TTML never supplied. */
        const personAgents: string[] = [];
        (lineRecords || []).forEach((record) => {
            if (
                !record ||
                record.isBackgroundVocal ||
                !record.vocalAgent ||
                record.vocalKind === "group" ||
                personAgents.includes(record.vocalAgent)
            ) {
                return;
            }
            personAgents.push(record.vocalAgent);
        });

        const laneForAgent = new Map<string | null, string>();
        const toneForAgent = new Map<string | null, number>();
        if (personAgents.length > 1) {
            const lanes = personAgents.length === 2 ? ["left", "right"] : ["left", "center", "right"];
            personAgents.forEach((agent, index: number) => {
                laneForAgent.set(agent, requireValue(lanes[index % lanes.length]));
                toneForAgent.set(agent, (index % 5) + 1);
            });
        }

        (lineRecords || []).forEach((record) => {
            const element = record && record.element;
            if (!element || !element.classList) return;

            const lane = record.isBackgroundVocal ? null : record.vocalKind === "group" ? "group" : laneForAgent.get(record.vocalAgent) || null;
            const tone = record.isBackgroundVocal ? null : record.vocalKind === "group" ? "group" : toneForAgent.get(record.vocalAgent) || null;

            record.vocalLane = lane;
            record.vocalTone = tone;
            element.classList.toggle("ak-vocal-lane-left", lane === "left");
            element.classList.toggle("ak-vocal-lane-center", lane === "center");
            element.classList.toggle("ak-vocal-lane-right", lane === "right");
            element.classList.toggle("ak-vocal-lane-group", lane === "group");
            [1, 2, 3, 4, 5].forEach((index: number) => {
                element.classList.toggle(`ak-vocal-tone-${index}`, tone === index);
            });
            element.classList.toggle("ak-vocal-tone-group", tone === "group");

            if (lane) {
                element.dataset.akVocalLane = lane;
            } else {
                delete element.dataset.akVocalLane;
            }
            if (tone) {
                element.dataset.akVocalTone = String(tone);
            } else {
                delete element.dataset.akVocalTone;
            }
        });
    }

    function applyBackgroundVocalAttachment(lineRecord: RenderLine, lineRecords: readonly RenderLine[]) {
        if (!lineRecord || !lineRecord.isBackgroundVocal || !lineRecord.element) {
            return null;
        }

        const attachment = backgroundVocalAttachmentFor(lineRecord, lineRecords);

        lineRecord.backgroundVocalAttachment = attachment.placement;
        lineRecord.backgroundVocalAnchorLineIndex = attachment.anchorLineIndex;
        lineRecord.element.dataset.akBackgroundAttachment = attachment.placement;

        if (attachment.anchorLineIndex === null) {
            delete lineRecord.element.dataset.akBackgroundAnchorLine;
        } else {
            lineRecord.element.dataset.akBackgroundAnchorLine = String(attachment.anchorLineIndex);
        }

        lineRecord.element.classList.add(`ak-bg-attached-${attachment.placement}`);

        return attachment;
    }

    function renderedLyricTextLeft(element: HTMLElement | null) {
        if (!element) return null;

        const children = Array.from(element.children || []);
        for (const child of children) {
            if (!child || !child.classList || (!child.classList.contains("ak-word") && !child.classList.contains("ak-untimed"))) {
                continue;
            }

            const textNode = Array.from(child.childNodes || []).find(
                (node: Node) => node && node.nodeType === Node.TEXT_NODE && /\S/u.test(String(node.textContent || "")),
            );
            if (!textNode) continue;

            const text = String(textNode.textContent || "");
            const start = Math.max(0, text.search(/\S/u));
            const range = document.createRange();

            try {
                range.setStart(textNode, start);
                range.setEnd(textNode, text.length);
                const rects = Array.from(range.getClientRects())
                    .map((rect) => Number(rect.left))
                    .filter(Number.isFinite);
                if (rects.length) return Math.min(...rects);
            } catch {
                // Layout/range APIs are optional during a detached DOM update.
            } finally {
                if (range.detach) range.detach();
            }
        }

        try {
            const left = Number(element.getBoundingClientRect().left);
            return isFiniteNumber(left) ? left : null;
        } catch {
            return null;
        }
    }

    function backgroundVocalAnchorOffset(backgroundElement: HTMLElement | null, anchorElement: HTMLElement | null) {
        if (
            !backgroundElement ||
            !anchorElement ||
            typeof backgroundElement.getBoundingClientRect !== "function" ||
            typeof anchorElement.getBoundingClientRect !== "function"
        ) {
            return null;
        }

        const backgroundLeft = renderedLyricTextLeft(backgroundElement);
        const anchorLeft = renderedLyricTextLeft(anchorElement);

        if (!isFiniteNumber(backgroundLeft) || !isFiniteNumber(anchorLeft)) {
            return null;
        }

        const appliedOffset = Number.parseFloat(
            backgroundElement.style && typeof backgroundElement.style.getPropertyValue === "function"
                ? backgroundElement.style.getPropertyValue("--ak-bg-anchor-offset")
                : "",
        );

        /* Rects already include the current CSS `left` value. Add the delta to
         * that value so repeated font/resize refreshes converge instead of
         * alternating between the original and aligned positions. */
        return Math.round(((isFiniteNumber(appliedOffset) ? appliedOffset : 0) + anchorLeft - backgroundLeft) * 100) / 100;
    }

    function alignBackgroundVocalAnchors() {
        const records = lyricsPort.snapshot.lineData || [];

        records.forEach((lineRecord) => {
            if (!lineRecord || !lineRecord.isBackgroundVocal) return;

            const anchor = records.find((candidate) => candidate && candidate.lineIndex === lineRecord.backgroundVocalAnchorLineIndex);
            const offset = backgroundVocalAnchorOffset(lineRecord.element, requireValue(anchor && anchor.element));

            if (offset === null) {
                lineRecord.element.style.removeProperty("--ak-bg-anchor-offset");
                return;
            }

            lineRecord.element.style.setProperty("--ak-bg-anchor-offset", `${offset.toFixed(2)}px`);
        });
    }

    function queueBackgroundVocalAnchorRefresh() {
        if (lyricsPort.snapshot.backgroundAnchorTimer) {
            lifecycle.clearTimeout(lyricsPort.snapshot.backgroundAnchorTimer);
        }

        /* Line state uses a CSS scale transition. Re-measure after it settles
         * so the background's rendered glyph—not merely its border box—stays
         * exactly flush with its selected lead on every phase change. */
        lyricsPort.setBackgroundAnchorTimer(
            lifecycle.timeout(() => {
                lyricsPort.setBackgroundAnchorTimer(0);
                if (lyricsPort.snapshot.lyrics && isLyricsPage()) {
                    alignBackgroundVocalAnchors();
                }
            }, 460),
        );
    }

    function inspectBackgroundVocals() {
        const lines = lyricsPort.snapshot.lineData
            .filter((line) => line.isBackgroundVocal)
            .map((line) => ({
                lineIndex: line.lineIndex,
                text: line.text,
                attachment: line.backgroundVocalAttachment,
                anchorLineIndex: line.backgroundVocalAnchorLineIndex,
                roleSource: line.backgroundVocalRoleSource,
                startSeconds: Number((line.startTicks / TICKS_PER_SECOND).toFixed(3)),
                endSeconds: Number((line.endTicks / TICKS_PER_SECOND).toFixed(3)),
            }));

        return {
            detected: lines.length,
            marker: "[ak:bg]",
            placement: "left-aligned + closest-lead-before-or-after",
            lines,
            cacheHint: lines.length
                ? null
                : "No x-bg role reached the renderer. Reconvert with the current converter so its [ak:bg] transport token is preserved.",
        };
    }

    function normalizedLyricDomText(value: unknown) {
        return String(value || "")
            .replace(/\s+/gu, " ")
            .trim();
    }

    function lyricDomIdentity(lyric: LyricInput) {
        const text = normalizedLyricDomText(lyricTextProfile(lyric).text);
        return stableHash(text).toString(16);
    }

    function lineHasOwnedLyricNodes(line: HTMLElement) {
        if (!line || !line.children) return false;
        return Array.from(line.children).some(
            (child) => child && child.classList && (child.classList.contains("ak-word") || child.classList.contains("ak-untimed")),
        );
    }

    function ownedLyricText(line: HTMLElement) {
        if (!line || !line.children) return "";

        return Array.from(line.children)
            .filter((child) => child && child.classList && (child.classList.contains("ak-word") || child.classList.contains("ak-untimed")))
            .map((child) =>
                Array.from(child.childNodes || [])
                    .filter((node: Node) => node && node.nodeType === Node.TEXT_NODE)
                    .map((node: Node) => String(node.textContent || ""))
                    .join(""),
            )
            .join("");
    }

    function lyricDomLineReady(line: HTMLElement, lyric: LyricInput) {
        if (!line || !lyric) return false;
        const expectedIdentity = lyricDomIdentity(lyric);
        if (line.dataset && line.dataset.akLyricIdentity === expectedIdentity) {
            return true;
        }

        /* A different LyricMotion identity means Jellyfin is still showing the
         * outgoing song. Wait until the framework actually replaces our owned
         * children instead of painting the new timing model onto stale text. */
        if (lineHasOwnedLyricNodes(line)) return false;

        const expected = normalizedLyricDomText(lyricTextProfile(lyric).text);
        /* Jellyfin can keep the ASCII transport marker in its native text
         * node. Compare display text on both sides so x-bg lines can be
         * decorated and stripped instead of timing out in the readiness loop. */
        const actual = normalizedLyricDomText(
            lyricTextProfile({
                Text: Array.from(line.childNodes)
                    .filter((node: Node) => !(node instanceof Element && node.classList.contains("lb-aux")))
                    .map((node: Node) => node.textContent || "")
                    .join(""),
            }).text,
        );
        return actual === expected;
    }

    function lyricsDomReadyForPayload(lines: HTMLElement[], lyrics: LyricInput[]) {
        if (!Array.isArray(lines) || !Array.isArray(lyrics) || !lyrics.length || lines.length !== lyrics.length) {
            return false;
        }

        for (let index = 0; index < lines.length; index += 1) {
            if (!lyricDomLineReady(requireValue(lines[index]), requireValue(lyrics[index]))) {
                return false;
            }
        }
        return true;
    }

    function restorePlainLyricsDom(lines: HTMLElement[], lyrics: LyricInput[], container: HTMLElement | null) {
        removeInstrumentalGapRows(container);
        let plainBackgroundVocalCount = 0;

        lines.forEach((line, index: number) => {
            if (!line || !line.classList) return;

            const textProfile = lyrics[index]
                ? lyricTextProfile(lyrics[index])
                : {
                      text: String(line.textContent || ""),
                      isBackgroundVocal: false,
                      backgroundVocalRoleSource: null,
                  };
            const plainText = textProfile.text;

            const wasEnhanced = line.classList.contains("ak-enhanced-line") || !!(line.dataset && line.dataset.akGeneration);

            Array.from(line.classList)
                .filter((name) => name.indexOf("ak-") === 0)
                .forEach((name) => line.classList.remove(name));

            line.classList.add("ak-plain-line", `ak-script-${detectScriptProfile(plainText)}`);
            line.classList.toggle("ak-background-vocal", textProfile.isBackgroundVocal);
            line.setAttribute("dir", firstStrongDirection(plainText));

            [
                "akGeneration",
                "akLyricIdentity",
                "akTimingLineIndex",
                "akVocalRole",
                "akVocalRoleSource",
                "akBackgroundAttachment",
                "akBackgroundAnchorLine",
            ].forEach((key) => {
                if (line.dataset) delete line.dataset[key];
            });

            if (textProfile.isBackgroundVocal) {
                plainBackgroundVocalCount += 1;
                if (line.dataset) {
                    line.dataset.akVocalRole = "background";
                    if (textProfile.backgroundVocalRoleSource) {
                        line.dataset.akVocalRoleSource = textProfile.backgroundVocalRoleSource;
                    }
                }
            }

            line.style.removeProperty("visibility");
            line.style.removeProperty("--ak-bg-anchor-offset");
            line.removeAttribute("aria-hidden");

            if (!lyrics[index]) return;

            const currentText = String(line.textContent || "");
            if (!wasEnhanced && currentText === plainText) return;

            /* Plain lyrics can arrive with LyricMotion's [ak:bg] transport
             * token still present in Jellyfin's native text node. Always repair
             * the node when its display text differs, not only when this line
             * used to be enhanced. This also clears stale owned word spans after
             * same-text song transitions. */
            line.removeAttribute("aria-label");
            replaceChildren(line);
            line.appendChild(document.createTextNode(plainText));
        });

        lyricsPort.setBackgroundVocalCount(plainBackgroundVocalCount);

        requireValue(container).classList.remove("ak-karaoke-container");
        requireValue(container).classList.add("ak-plain-lyrics-container");
        lyricsPort.setLineData([]);
        lyricsPort.setLineEndPrefix([]);
        lyricsPort.setInstrumentalGaps([]);
        lyricsPort.setActiveLineIndexes([]);
        resetMotionHandoffs();
        lyricsPort.setLastActiveLine(-999);
        lyricsPort.setLastActiveLineSignature("");
        lyricsPort.setActiveInstrumentalGapIndex(-1);
        lyricsPort.setDecoratedGeneration(lyricsPort.snapshot.generation);

        if (typeof removeRomanizationToggle === "function") {
            removeRomanizationToggle();
        }
        if (typeof removeTimingControls === "function") {
            removeTimingControls();
        }

        stopAnimationLoop("plain-unsynced-lyrics");
    }

    function lineRecordHealthy(lineRecord: RenderLine) {
        const element = lineRecord && lineRecord.element;
        if (
            !element ||
            !element.isConnected ||
            !element.classList ||
            !element.classList.contains("ak-enhanced-line") ||
            Number(element.dataset && element.dataset.akGeneration) !== lyricsPort.snapshot.generation
        ) {
            return false;
        }

        const ownedNodes = lineRecord.ownedNodes;
        if (!Array.isArray(ownedNodes) || !ownedNodes.length) {
            return false;
        }

        const liveChildren = Array.from(element.children || []).filter((child) => !child.classList.contains("lb-aux"));
        if (liveChildren.length !== ownedNodes.length) return false;
        const ownsExpectedNodes = ownedNodes.every(
            (node: Node, index: number) => node && node.parentNode === element && liveChildren[index] === node,
        );

        return ownsExpectedNodes && normalizedLyricDomText(ownedLyricText(element)) === normalizedLyricDomText(lineRecord.ownedText);
    }

    function instrumentalGapRowsHealthy() {
        return lyricsPort.snapshot.instrumentalGaps.every((gap) => gap && gap.element && gap.element.isConnected && !!gap.element.parentNode);
    }

    function plainLyricTypographyHealthy() {
        const container = getCurrentLyricsContainer(false);
        if (!container || !container.classList.contains("ak-plain-lyrics-container")) {
            return false;
        }

        const lines = Array.from(container.querySelectorAll<HTMLElement>(".lyricsLine"));
        const lyrics = Array.isArray(lyricsPort.snapshot.lyrics) ? lyricsPort.snapshot.lyrics : [];

        return (
            lines.length === lyrics.length &&
            lines.every((line, index: number) => {
                const profile = lyricTextProfile(requireValue(lyrics[index]));
                const text = profile.text;
                return (
                    line.classList.contains("ak-plain-line") &&
                    line.classList.contains(`ak-script-${detectScriptProfile(text)}`) &&
                    line.classList.contains("ak-background-vocal") === profile.isBackgroundVocal &&
                    line.getAttribute("dir") === firstStrongDirection(text) &&
                    String(
                        Array.from(line.childNodes)
                            .filter((node: Node) => !(node instanceof Element && node.classList.contains("lb-aux")))
                            .map((node: Node) => node.textContent || "")
                            .join(""),
                    ) === text
                );
            })
        );
    }

    function lyricVisualDomHealthy() {
        if (lyricsPort.snapshot.lyricTimingMode === "plain") {
            return (
                lyricsPort.snapshot.decoratedGeneration === lyricsPort.snapshot.generation &&
                lyricsPort.snapshot.lineData.length === 0 &&
                plainLyricTypographyHealthy()
            );
        }

        return (
            lyricsPort.snapshot.decoratedGeneration === lyricsPort.snapshot.generation &&
            lyricsPort.snapshot.lineData.length > 0 &&
            lyricsPort.snapshot.lineData.every(lineRecordHealthy) &&
            instrumentalGapRowsHealthy()
        );
    }

    async function decorateExistingLines() {
        const generation = lyricsPort.snapshot.generation;
        if (hostPort.snapshot.lyricViewHidden || !lyricsPort.snapshot.lyrics || !isLyricsPage()) return false;
        const container = getCurrentLyricsContainer(false);
        if (!container) return false;

        const lines = Array.from(container.querySelectorAll<HTMLElement>(".lyricsLine"));
        if (!lines.length) return false;

        if (!lyricsDomReadyForPayload(lines, lyricsPort.snapshot.lyrics)) {
            return false;
        }

        if (lyricsPort.snapshot.lyricTimingMode === "plain") {
            restorePlainLyricsDom(lines, lyricsPort.snapshot.lyrics, container);
            if (window.LyricBridge) window.LyricBridge.decorate(lines, lyricsPort.snapshot.lyrics);
            return true;
        }

        container.classList.remove("ak-plain-lyrics-container");
        container.setAttribute("aria-description", "Space plays or pauses music. Enter seeks to a focused lyric.");

        /* Jellyfin's native follower uses raw lyric timestamps. LyricMotion
         * uses the user's corrected timeline, so synchronized lyrics must have
         * exactly one scroll owner or a nonzero offset makes the two targets
         * alternate vertically on every playback update. */
        suppressJellyfinLyricAutoFollow("synchronized-lyrics-decorated");

        removeInstrumentalGapRows(container);

        const count = lines.length;
        lyricsPort.setLineData([]);
        lyricsPort.setShapedWordCount(0);
        lyricsPort.setScriptProfileCounts({});
        lyricsPort.setBackgroundVocalCount(0);
        pronunciationPort.setRomanizationLineCount(0);

        let batchStart = performance.now();
        for (let i = 0; i < count; i += 1) {
            if (
                lifecycle.isDisposed ||
                hostPort.snapshot.lyricViewHidden ||
                generation !== lyricsPort.snapshot.generation ||
                !container.isConnected ||
                !isLyricsPage()
            )
                return false;
            const lineRecord = decorateLine(requireValue(lines[i]), requireValue(lyricsPort.snapshot.lyrics[i]), i);

            lyricsPort.appendLineData(lineRecord);

            if (lineRecord.isBackgroundVocal) {
                lyricsPort.setBackgroundVocalCount(lyricsPort.snapshot.backgroundVocalCount + 1);
            }

            (lineRecord.words || []).forEach((word) => {
                const profile = word.scriptProfile || "spatial";

                lyricsPort.setScriptProfileCountsEntry(profile, (lyricsPort.snapshot.scriptProfileCounts[profile] || 0) + 1);

                if (word.paintMode === "shaped") {
                    lyricsPort.setShapedWordCount(lyricsPort.snapshot.shapedWordCount + 1);
                }
            });
            if (performance.now() - batchStart >= 8) {
                await yieldLyricsWork();
                batchStart = performance.now();
            }
        }

        if (
            lifecycle.isDisposed ||
            hostPort.snapshot.lyricViewHidden ||
            generation !== lyricsPort.snapshot.generation ||
            !container.isConnected ||
            !isLyricsPage()
        )
            return false;
        if (window.LyricBridge) window.LyricBridge.decorate(lines, lyricsPort.snapshot.lyrics);
        applyVocalLanes(lyricsPort.snapshot.lineData);

        lyricsPort.snapshot.lineData.forEach((lineRecord) => {
            if (lineRecord.isBackgroundVocal) {
                applyBackgroundVocalAttachment(lineRecord, lyricsPort.snapshot.lineData);
            }
        });

        let prefixEnd = -Infinity;
        lyricsPort.setLineEndPrefix(
            lyricsPort.snapshot.lineData.map((lineRecord) => {
                prefixEnd = Math.max(prefixEnd, Number(lineRecord.endTicks) || -Infinity);
                return prefixEnd;
            }),
        );

        installInstrumentalGapRows(container);

        lyricsPort.setDecoratedGeneration(lyricsPort.snapshot.generation);
        lyricsPort.setLastActiveLine(-999);
        lyricsPort.setLastActiveLineSignature("");
        lyricsPort.setActiveLineIndexes([]);
        resetMotionHandoffs();
        invalidateFollowTarget();

        container.classList.add("ak-karaoke-container");
        ensureRomanizationToggle();
        ensureTimingControls();

        applyAccentTheme();
        applyPerformanceProfile(false);
        /* Geometry is measured once after all lyric DOM has been decorated.
         * FontFaceSet hooks below schedule another pass only if fonts actually
         * finish loading later. Avoid synchronous per-line layout reads here. */
        queueMotionGeometryRefresh();

        ensureAnimationLoop();
        return true;
    }

    let decorateTimer = 0,
        decorationInProgress = false;

    function cancelDecorationRetry(resetWindow = true) {
        if (decorateTimer) {
            lifecycle.clearTimeout(decorateTimer);
            decorateTimer = 0;
        }

        if (resetWindow) {
            lyricsPort.setDecorationRetryStartedAt(0);
            lyricsPort.setDecorationRetryCount(0);
        }
    }

    async function runDecorationAttempt() {
        decorateTimer = 0;
        if (decorationInProgress) return;

        if (document.hidden || !lyricsPort.snapshot.lyrics || !isLyricsPage()) {
            cancelDecorationRetry(true);
            return;
        }

        const generation = lyricsPort.snapshot.generation;
        decorationInProgress = true;
        let decorated = false;
        try {
            decorated = await decorateExistingLines();
        } catch (error) {
            warn("Lyric decoration failed", error);
        } finally {
            decorationInProgress = false;
        }
        if (generation !== lyricsPort.snapshot.generation) {
            queueDecoration();
            return;
        }
        if (decorated) {
            cancelDecorationRetry(true);
            return;
        }

        const now = performance.now();

        if (!lyricsPort.snapshot.decorationRetryStartedAt) {
            lyricsPort.setDecorationRetryStartedAt(now);
        }

        if (now - lyricsPort.snapshot.decorationRetryStartedAt >= DECORATION_RETRY_WINDOW_MS) {
            lyricsPort.setDecorationRetryExpiredCount(lyricsPort.snapshot.decorationRetryExpiredCount + 1);
            cancelDecorationRetry(true);
            warn("Lyrics DOM did not become ready before the decoration retry window expired.");
            return;
        }

        lyricsPort.setDecorationRetryCount(lyricsPort.snapshot.decorationRetryCount + 1);
        decorateTimer = lifecycle.timeout(runDecorationAttempt, DECORATION_RETRY_MS);
    }

    function queueDecoration() {
        if (document.hidden || !lyricsPort.snapshot.lyrics || !isLyricsPage()) {
            cancelDecorationRetry(true);
            return false;
        }

        if (!lyricsPort.snapshot.decorationRetryStartedAt) {
            lyricsPort.setDecorationRetryStartedAt(performance.now());
        }

        if (decorateTimer) {
            lifecycle.clearTimeout(decorateTimer);
        }

        decorateTimer = lifecycle.timeout(runDecorationAttempt, 0);

        return true;
    }

    function isMobileEnvironment() {
        const ua = String(navigator.userAgent || "").toLowerCase();

        return ua.includes("android") || ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod") || ua.includes("mobile");
    }

    return {
        decorationInProgress: () => decorationInProgress,
        decorateLine,
        backgroundVocalAttachmentFor,
        applyVocalLanes,
        applyBackgroundVocalAttachment,
        renderedLyricTextLeft,
        backgroundVocalAnchorOffset,
        alignBackgroundVocalAnchors,
        queueBackgroundVocalAnchorRefresh,
        inspectBackgroundVocals,
        normalizedLyricDomText,
        lyricDomIdentity,
        lineHasOwnedLyricNodes,
        ownedLyricText,
        lyricDomLineReady,
        lyricsDomReadyForPayload,
        restorePlainLyricsDom,
        lineRecordHealthy,
        instrumentalGapRowsHealthy,
        plainLyricTypographyHealthy,
        lyricVisualDomHealthy,
        decorateExistingLines,
        cancelDecorationRetry,
        runDecorationAttempt,
        queueDecoration,
        isMobileEnvironment,
    };
}
