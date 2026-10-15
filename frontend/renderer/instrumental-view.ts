/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
import { requireValue } from "../shared/invariants.ts";
import { getCurrentLyricsContainer } from "./host.ts";
import type { RenderGap } from "./models.ts";
import { clamp01 } from "./motion.ts";
import type { RendererState } from "./state.ts";
import { planInstrumentalGaps } from "./timeline.ts";

interface Dependencies {
    instrumentalSeekCount: () => number;
    state: Pick<
        RendererState,
        | "generation"
        | "lineData"
        | "instrumentalGaps"
        | "activeInstrumentalGapIndex"
        | "instrumentalPhaseActiveIndex"
        | "instrumentalPastCount"
        | "instrumentalGapRenderCount"
        | "instrumentalGapMaxDurationTicks"
    >;
    finiteNumber: (value: unknown, fallback?: number) => number;
    prefersReducedMotion: () => boolean;
    smoothstepBetween: (start: number, end: number, value: number) => number;
}

/** Owns instrumental rows, media-time liquid fill and seek-aware phases. */
export function createInstrumentalView({ state, instrumentalSeekCount, finiteNumber, prefersReducedMotion, smoothstepBetween }: Dependencies) {
    const TICKS_PER_SECOND = 10000000;
    const INSTRUMENTAL_GAP_MIN_TICKS = 2 * TICKS_PER_SECOND;
    const INSTRUMENTAL_GAP_SYMBOL = "♪";
    const SVG_NS = "http://www.w3.org/2000/svg";
    const INSTRUMENTAL_NOTE_VIEWBOX_WIDTH = 64;
    const INSTRUMENTAL_NOTE_VIEWBOX_HEIGHT = 80;
    const INSTRUMENTAL_GAP_PROGRESS_EPSILON = 0.001;
    const INSTRUMENTAL_WAVE_PERIOD_SECONDS = 1.35;
    const INSTRUMENTAL_WAVE_MAX_AMPLITUDE = 2.35;
    const INSTRUMENTAL_WAVE_SEGMENTS = 20;

    function createSvgElement(name: string, attributes: Record<string, string | number> | null = null) {
        const node = document.createElementNS(SVG_NS, name);

        if (attributes) {
            Object.entries(attributes).forEach(([key, value]) => {
                node.setAttribute(key, String(value));
            });
        }

        return node;
    }

    const INSTRUMENTAL_NOTE_PATH =
        "M18.15 72.25C10.90 72.25 5.75 68.35 5.75 62.85" +
        "C5.75 56.75 12.10 51.55 20.25 51.55" +
        "C24.55 51.55 28.15 52.70 30.75 54.60" +
        "V13.45C30.75 11.65 32.20 10.20 34.00 10.20H37.05" +
        "C47.90 10.20 56.20 15.10 59.10 23.35" +
        "C60.55 27.45 60.10 31.60 58.00 35.00" +
        "C53.35 31.30 47.05 29.10 38.55 28.70V59.10" +
        "C38.55 66.65 29.80 72.25 18.15 72.25Z";

    function appendInstrumentalNoteShape(parent: SVGElement, className = "") {
        if (!parent) return;

        /* One closed silhouette is used for base paint, liquid paint and clip.
         * The previous ellipse+rect+flag construction could expose seams at
         * fractional scaling and made the moving clip look broken in Chromium. */
        const shape = createSvgElement("path", {
            d: INSTRUMENTAL_NOTE_PATH,
            "fill-rule": "nonzero",
            "clip-rule": "nonzero",
        });

        if (className) shape.setAttribute("class", className);
        parent.appendChild(shape);
    }

    function instrumentalWaveMotionAllowed() {
        return !prefersReducedMotion();
    }

    function instrumentalWaveGeometry(gap: RenderGap, progress: number, ticks: number | null = null) {
        const normalized = clamp01(finiteNumber(progress, 0));
        const baseY = INSTRUMENTAL_NOTE_VIEWBOX_HEIGHT * (1 - normalized);

        /*
         * The liquid surface remains alive through most of the break, then
         * intentionally settles before the next vocal arrives. Motion is
         * derived from media time, not a free-running CSS timer, so pause and
         * seek are deterministic. Reduced-motion clients receive the
         * same fill progression with a flat surface.
         */
        const riseIn = smoothstepBetween(0.015, 0.09, normalized);
        const flattenOut = 1 - smoothstepBetween(0.68, 0.98, normalized);
        const amplitude = instrumentalWaveMotionAllowed() ? INSTRUMENTAL_WAVE_MAX_AMPLITUDE * riseIn * flattenOut : 0;

        const elapsedSeconds = gap ? Math.max(0, (finiteNumber(ticks, gap.startTicks) - gap.startTicks) / TICKS_PER_SECOND) : 0;
        const phase = (elapsedSeconds / INSTRUMENTAL_WAVE_PERIOD_SECONDS) * Math.PI * 2;

        const points = [];
        for (let index = 0; index <= INSTRUMENTAL_WAVE_SEGMENTS; index += 1) {
            const ratio = index / INSTRUMENTAL_WAVE_SEGMENTS;
            const x = INSTRUMENTAL_NOTE_VIEWBOX_WIDTH * ratio;
            const y = Math.max(0, Math.min(INSTRUMENTAL_NOTE_VIEWBOX_HEIGHT, baseY + amplitude * Math.sin(phase + ratio * Math.PI * 2)));

            points.push([x, y]);
        }

        const surfacePath = points
            .map((point, index: number) => `${index ? "L" : "M"}${requireValue(point[0]).toFixed(3)} ${requireValue(point[1]).toFixed(3)}`)
            .join(" ");
        const fillPath =
            `${surfacePath} ` +
            `L${INSTRUMENTAL_NOTE_VIEWBOX_WIDTH} ${INSTRUMENTAL_NOTE_VIEWBOX_HEIGHT} ` +
            `L0 ${INSTRUMENTAL_NOTE_VIEWBOX_HEIGHT} Z`;

        return {
            baseY,
            amplitude,
            phase,
            fillPath,
            surfacePath,
        };
    }

    function setInstrumentalGapFill(gap: RenderGap, progress: number, ticks: number | null = null) {
        if (!gap || !gap.element) return 0;

        const normalized = clamp01(finiteNumber(progress, 0));
        const geometry = instrumentalWaveGeometry(gap, normalized, ticks);

        if (gap.fillClipElement) {
            gap.fillClipElement.setAttribute("d", geometry.fillPath);
        }

        if (gap.surfaceElement) {
            gap.surfaceElement.setAttribute("d", geometry.surfacePath);
            gap.surfaceElement.style.opacity = normalized > 0.02 && normalized < 0.992 ? "1" : "0";
        }

        gap.lastProgress = normalized;
        gap.lastWavePhase = geometry.phase;
        gap.lastWaveAmplitude = geometry.amplitude;
        return normalized;
    }

    function setInstrumentalGapPhase(gap: RenderGap | null | undefined, phase: string) {
        if (!gap || !gap.element || gap.visualPhase === phase) {
            return false;
        }

        gap.visualPhase = phase;
        gap.element.classList.toggle("ak-future", phase === "future");
        gap.element.classList.toggle("ak-active", phase === "active");
        gap.element.classList.toggle("ak-past", phase === "past");

        if (phase === "future") {
            setInstrumentalGapFill(gap, 0);
        } else if (phase === "past") {
            setInstrumentalGapFill(gap, 1);
        }

        return true;
    }

    function instrumentalPastCountAtTicks(ticks: number) {
        const gaps = state.instrumentalGaps;
        if (!gaps.length) return 0;

        const now = finiteNumber(ticks, 0);
        let low = 0;
        let high = gaps.length;

        /* Upper-bound search on endTicks: number of fully completed gaps. */
        while (low < high) {
            const middle = (low + high) >> 1;
            if (requireValue(gaps[middle]).endTicks <= now) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }

        return low;
    }

    function syncInstrumentalGapPhases(ticks: number, activeGap: RenderGap | null = null) {
        const gaps = state.instrumentalGaps;
        if (!gaps.length) {
            state.instrumentalPastCount = 0;
            state.instrumentalPhaseActiveIndex = -1;
            return;
        }

        const pastCount = instrumentalPastCountAtTicks(ticks);
        const previousPastCount = Math.max(0, Math.min(gaps.length, state.instrumentalPastCount || 0));
        const activeIndex = activeGap ? finiteNumber(activeGap.index, -1) : -1;
        const previousActiveIndex = finiteNumber(state.instrumentalPhaseActiveIndex, -1);

        /*
         * Normal playback crosses at most one boundary at a time. Update only
         * rows whose phase can have changed instead of rescanning every
         * instrumental row on every animation frame. Arbitrary seeks remain
         * correct because the changed past/future range is replayed here.
         */
        if (pastCount > previousPastCount) {
            for (let index = previousPastCount; index < pastCount; index += 1) {
                if (index !== activeIndex) {
                    setInstrumentalGapPhase(gaps[index], "past");
                }
            }
        } else if (pastCount < previousPastCount) {
            for (let index = pastCount; index < previousPastCount; index += 1) {
                if (index !== activeIndex) {
                    setInstrumentalGapPhase(gaps[index], "future");
                }
            }
        }

        if (previousActiveIndex >= 0 && previousActiveIndex < gaps.length && previousActiveIndex !== activeIndex) {
            setInstrumentalGapPhase(gaps[previousActiveIndex], previousActiveIndex < pastCount ? "past" : "future");
        }

        if (activeIndex >= 0 && activeIndex < gaps.length) {
            setInstrumentalGapPhase(gaps[activeIndex], "active");
        }

        state.instrumentalPastCount = pastCount;
        state.instrumentalPhaseActiveIndex = activeIndex;
    }

    function createInstrumentalGapRow(gap: RenderGap) {
        if (!gap) return null;

        const row = document.createElement("div");
        row.className = "ak-instrumental-gap-line ak-future";
        row.dataset.akInstrumentalGap = String(gap.index);
        row.dataset.akInstrumentalNextLine = String(gap.nextLineIndex);

        const note = document.createElement("span");
        note.className = "ak-instrumental-note";
        note.setAttribute("role", "button");
        note.setAttribute("tabindex", "0");
        note.setAttribute("aria-label", `Seek to start of ${Math.max(0, gap.durationTicks / TICKS_PER_SECOND).toFixed(1)} second instrumental break`);
        note.setAttribute("title", "Enter or click to seek to the instrumental break; Space plays or pauses");

        const svg = createSvgElement("svg", {
            class: "ak-instrumental-note-svg",
            viewBox: `0 0 ${INSTRUMENTAL_NOTE_VIEWBOX_WIDTH} ${INSTRUMENTAL_NOTE_VIEWBOX_HEIGHT}`,
            "aria-hidden": "true",
            focusable: "false",
            role: "presentation",
        });

        const defs = createSvgElement("defs");
        const idRoot = `ak-instrumental-${state.generation}-${gap.index}`;
        const fillClipId = `${idRoot}-fill`;
        const shapeClipId = `${idRoot}-shape`;

        const fillClip = createSvgElement("clipPath", {
            id: fillClipId,
            clipPathUnits: "userSpaceOnUse",
        });
        const fillWave = createSvgElement("path", {
            d:
                `M0 ${INSTRUMENTAL_NOTE_VIEWBOX_HEIGHT} ` +
                `L${INSTRUMENTAL_NOTE_VIEWBOX_WIDTH} ${INSTRUMENTAL_NOTE_VIEWBOX_HEIGHT} ` +
                `L${INSTRUMENTAL_NOTE_VIEWBOX_WIDTH} ${INSTRUMENTAL_NOTE_VIEWBOX_HEIGHT} ` +
                `L0 ${INSTRUMENTAL_NOTE_VIEWBOX_HEIGHT} Z`,
        });
        fillClip.appendChild(fillWave);

        const shapeClip = createSvgElement("clipPath", {
            id: shapeClipId,
            clipPathUnits: "userSpaceOnUse",
        });
        appendInstrumentalNoteShape(shapeClip);

        defs.appendChild(fillClip);
        defs.appendChild(shapeClip);
        svg.appendChild(defs);

        const base = createSvgElement("g", {
            class: "ak-instrumental-note-base-vector",
        });
        appendInstrumentalNoteShape(base);
        svg.appendChild(base);

        const liquid = createSvgElement("g", {
            class: "ak-instrumental-note-liquid",
            "clip-path": `url(#${fillClipId})`,
        });
        appendInstrumentalNoteShape(liquid);
        svg.appendChild(liquid);

        const surface = createSvgElement("path", {
            class: "ak-instrumental-note-surface",
            d: `M0 ${INSTRUMENTAL_NOTE_VIEWBOX_HEIGHT} ` + `L${INSTRUMENTAL_NOTE_VIEWBOX_WIDTH} ${INSTRUMENTAL_NOTE_VIEWBOX_HEIGHT}`,
            "clip-path": `url(#${shapeClipId})`,
        });
        svg.appendChild(surface);

        note.appendChild(svg);
        row.appendChild(note);

        gap.element = row;
        gap.fillClipElement = fillWave;
        gap.surfaceElement = surface;
        gap.visualPhase = "future";
        gap.lastProgress = 0;
        setInstrumentalGapFill(gap, 0);

        return row;
    }

    function removeInstrumentalGapRows(container: HTMLElement | null = null) {
        state.instrumentalGaps.forEach((gap) => {
            const element = gap && gap.element;

            if (element && element.parentNode) {
                try {
                    element.parentNode.removeChild(element);
                } catch {
                    // Framework-owned lyric DOM can disappear during cleanup.
                }
            }
        });

        const root = container || getCurrentLyricsContainer(true);

        if (root && typeof root.querySelectorAll === "function") {
            try {
                Array.from(root.querySelectorAll<HTMLElement>(".ak-instrumental-gap-line")).forEach((element: HTMLElement) => {
                    if (element.parentNode) {
                        element.parentNode.removeChild(element);
                    }
                });
            } catch {
                // Best-effort stale-row cleanup only.
            }
        }

        state.instrumentalGaps = [];
        state.activeInstrumentalGapIndex = -1;
        state.instrumentalPhaseActiveIndex = -1;
        state.instrumentalPastCount = 0;
    }

    function installInstrumentalGapRows(container: HTMLElement | null) {
        removeInstrumentalGapRows(container);

        const gaps = planInstrumentalGaps(state.lineData);

        gaps.forEach((gap) => {
            const nextLine = state.lineData[gap.nextLineIndex];
            const nextElement = nextLine && nextLine.element;
            const parent = nextElement && nextElement.parentNode;

            if (!parent) return;

            const row = createInstrumentalGapRow(gap);

            if (!row) return;

            /*
             * Follow the upcoming lyric's base direction so mixed LTR/RTL
             * songs place the synthetic note on the same reading lane instead
             * of inheriting only the document direction.
             */
            try {
                const direction = String(nextElement.getAttribute("dir") || "").toLowerCase();
                if (direction === "rtl" || direction === "ltr") {
                    row.setAttribute("dir", direction);
                }
            } catch {
                // Direction is visual-only; never block lyric decoration.
            }

            parent.insertBefore(row, nextElement);
        });

        state.instrumentalGaps = gaps.filter((gap) => !!gap.element);
        state.instrumentalGaps.forEach((gap, index: number) => {
            gap.index = index;
            if (gap.element) {
                gap.element.dataset.akInstrumentalGap = String(index);
            }
        });
        state.instrumentalGapMaxDurationTicks = state.instrumentalGaps.reduce((maximum, gap) => Math.max(maximum, gap.durationTicks), 0);
        state.activeInstrumentalGapIndex = -1;
        state.instrumentalPhaseActiveIndex = -1;
        state.instrumentalPastCount = 0;

        return state.instrumentalGaps;
    }

    function findInstrumentalGapInList(gaps: RenderGap[], ticks: number) {
        if (!gaps || !gaps.length) return null;

        let low = 0;
        let high = gaps.length - 1;
        let candidate = -1;

        while (low <= high) {
            const middle = (low + high) >> 1;
            const gap = gaps[middle];

            if (requireValue(gap).startTicks <= ticks) {
                candidate = middle;
                low = middle + 1;
            } else {
                high = middle - 1;
            }
        }

        if (candidate < 0) return null;

        const gap = gaps[candidate];

        return ticks >= requireValue(gap).startTicks && ticks < requireValue(gap).endTicks ? gap : null;
    }

    function findInstrumentalGapAtTicks(ticks: number) {
        return findInstrumentalGapInList(state.instrumentalGaps, ticks);
    }

    function instrumentalGapProgress(gap: RenderGap, ticks: number) {
        if (!gap) return 0;

        const duration = Math.max(1, finiteNumber(gap.durationTicks, 0));

        return Math.max(0, Math.min(1, (finiteNumber(ticks, gap.startTicks) - gap.startTicks) / duration));
    }

    function instrumentalGapDistanceBand(lineIndex: number, nextLineIndex: number) {
        const center = nextLineIndex - 0.5;
        const distance = Math.abs(lineIndex - center);

        /*
         * No lyric line is the visual focus during an instrumental gap.
         * Returning near/near2 here used to keep the lines immediately around
         * the synthetic note too bright, making the completed lyric compete
         * with the progress indicator. Preserve only the far-distance fade;
         * the normal past/future phase opacity handles nearby lyrics.
         */
        if (distance >= 4.5) return "far";
        return "middle";
    }

    function updateInstrumentalGapVisual(gap: RenderGap | null | undefined, ticks: number) {
        const nextIndex = gap ? gap.index : -1;
        const previousIndex = state.activeInstrumentalGapIndex;

        if (previousIndex !== nextIndex) {
            if (gap) {
                state.instrumentalGapRenderCount += 1;
            }
            state.activeInstrumentalGapIndex = nextIndex;
        }

        /*
         * Synthetic note rows remain visible as dim future/past lyric items,
         * just like the surrounding text. This prevents the indicator from
         * popping into existence at the exact gap boundary and also makes
         * seek-back/seek-forward state deterministic.
         */
        syncInstrumentalGapPhases(ticks, gap ?? null);

        if (!gap || !gap.element || !gap.element.isConnected || !gap.element.parentNode) {
            return 0;
        }

        const progress = instrumentalGapProgress(gap, ticks);

        const currentTicks = finiteNumber(ticks, gap.startTicks);
        const playbackAdvanced = gap.lastRenderTicks !== currentTicks;
        const animatedSurface = instrumentalWaveMotionAllowed();

        if (
            gap.lastProgress < 0 ||
            Math.abs(progress - gap.lastProgress) >= INSTRUMENTAL_GAP_PROGRESS_EPSILON ||
            (animatedSurface && playbackAdvanced)
        ) {
            setInstrumentalGapFill(gap, progress, currentTicks);
            gap.lastRenderTicks = currentTicks;
        }

        return progress;
    }

    function inspectInstrumentalBreaks() {
        const active = state.instrumentalGaps[state.activeInstrumentalGapIndex] || null;

        return {
            symbol: INSTRUMENTAL_GAP_SYMBOL,
            visualRenderer: "inline-svg-liquid-wave-v3",
            transitionModel: "future-active-past",
            rectangularTextClipArtifact: false,
            liquidSurface: "media-time-wave+progressive-flattening",
            reducedMotionSurface: "flat",
            seekable: true,
            seekTarget: "gap-start",
            keyboardActivation: "enter-seek-space-playback",
            seekCount: instrumentalSeekCount(),
            minimumGapSeconds: INSTRUMENTAL_GAP_MIN_TICKS / TICKS_PER_SECOND,
            detected: state.instrumentalGaps.length,
            activeIndex: state.activeInstrumentalGapIndex,
            active: active
                ? {
                      startSeconds: Number((active.startTicks / TICKS_PER_SECOND).toFixed(3)),
                      endSeconds: Number((active.endTicks / TICKS_PER_SECOND).toFixed(3)),
                      durationSeconds: Number((active.durationTicks / TICKS_PER_SECOND).toFixed(3)),
                      nextLineIndex: active.nextLineIndex,
                      intro: !!active.isIntro,
                      progress: active.lastProgress >= 0 ? Number(active.lastProgress.toFixed(4)) : 0,
                  }
                : null,
            renderCount: state.instrumentalGapRenderCount,
            longestSeconds: Number((state.instrumentalGapMaxDurationTicks / TICKS_PER_SECOND).toFixed(3)),
            gaps: state.instrumentalGaps.map((gap) => ({
                startSeconds: Number((gap.startTicks / TICKS_PER_SECOND).toFixed(3)),
                endSeconds: Number((gap.endTicks / TICKS_PER_SECOND).toFixed(3)),
                durationSeconds: Number((gap.durationTicks / TICKS_PER_SECOND).toFixed(3)),
                nextLineIndex: gap.nextLineIndex,
                intro: !!gap.isIntro,
            })),
        };
    }

    return {
        removeInstrumentalGapRows,
        installInstrumentalGapRows,
        findInstrumentalGapAtTicks,
        instrumentalGapDistanceBand,
        updateInstrumentalGapVisual,
        inspectInstrumentalBreaks,
    };
}
