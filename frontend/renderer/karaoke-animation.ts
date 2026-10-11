/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
import { clamp01, easeMotion } from "./motion.ts";
export interface MotionMetrics {
    maxScale: number;
    offsetXEm: number;
    peakYEm: number;
    shadowIntensity: number;
}
export interface GlowOwner {
    _akGlowCoreBucket?: number;
    _akGlowHaloBucket?: number;
}
export interface MotionGlyph extends HTMLElement, GlowOwner {
    _akMotion?: MotionMetrics;
    glowLayers?: HTMLElement[];
}
export interface WordSegment {
    start: number;
    end: number;
    startPos: number;
    endPos: number;
    visualStart?: number;
    visualEnd?: number;
}
export interface AnimatedWord extends GlowOwner {
    start: number;
    end: number;
    length: number;
    segments: WordSegment[];
    visualProgress: number;
    lastPaintAt: number;
    motionMode: string;
    motionDurationMs: number;
    element?: HTMLElement | null;
    motionGlyphs?: MotionGlyph[];
    wholeMotion?: MotionMetrics | null;
    glowLayers?: HTMLElement[];
    _akMotionIsReset?: boolean;
    _akWholeFilterCleared?: boolean;
    _akStaticState?: string;
    _akProgressBucket?: number;
}
const WORD_PROGRESS_SNAP_DELTA = 0.42;
export const WORD_PROGRESS_SMOOTH_TAU_MS = 20;
export const MOTION_HANDOFF_TICKS = 3200000; // 320 ms previous-line glow decay
const MOTION_FINAL_RISE_EM = -0.035;
const ZERO_PROGRESS_EPSILON = 0.0025;

export function createKaraokeAnimation(currentAccent: () => { gain: number }) {
    function smoothWordProgress(word: AnimatedWord, target: number, frameNow: number) {
        target = Number.isFinite(target) ? Math.max(0, Math.min(1, target)) : 0;

        if (!Number.isFinite(word.visualProgress)) {
            word.visualProgress = target;
        }

        if (!Number.isFinite(word.lastPaintAt)) {
            word.lastPaintAt = frameNow;
        }

        let dt = frameNow - word.lastPaintAt;
        word.lastPaintAt = frameNow;

        if (!Number.isFinite(dt) || dt < 0) dt = 0;
        dt = Math.min(dt, 64);

        const difference = target - word.visualProgress;

        // Seeking/song jumps snap. Normal playback receives a tiny low-pass.
        if (Math.abs(difference) >= WORD_PROGRESS_SNAP_DELTA) {
            word.visualProgress = target;
        } else {
            const alpha = 1 - Math.exp(-dt / WORD_PROGRESS_SMOOTH_TAU_MS);
            word.visualProgress += difference * alpha;
        }

        if (target === 0 && word.visualProgress < 0.0008) {
            word.visualProgress = 0;
        }

        if (target === 1 && word.visualProgress > 0.9992) {
            word.visualProgress = 1;
        }

        return word.visualProgress;
    }

    function wordTargetProgress(word: AnimatedWord, timelineTicks: number) {
        if (
            !word ||
            !Array.isArray(word.segments) ||
            !word.segments.length ||
            !Number.isFinite(word.start) ||
            !Number.isFinite(word.end) ||
            !Number.isFinite(timelineTicks)
        ) {
            return 0;
        }

        if (timelineTicks >= word.end) return 1;

        if (timelineTicks <= word.start) {
            return 0;
        }

        let completed = 0;
        const wordLength = Math.max(1, Number(word.length) || 1);

        for (const segment of word.segments) {
            if (!segment || !Number.isFinite(segment.start) || !Number.isFinite(segment.end)) {
                continue;
            }

            const visualStart = Number.isFinite(segment.visualStart)
                ? clamp01(segment.visualStart!)
                : clamp01((Number(segment.startPos) || 0) / wordLength);

            const visualEnd = Number.isFinite(segment.visualEnd) ? clamp01(segment.visualEnd!) : clamp01((Number(segment.endPos) || 0) / wordLength);

            if (timelineTicks < segment.start) {
                return completed;
            }

            if (timelineTicks <= segment.end && segment.end > segment.start) {
                const local = clamp01((timelineTicks - segment.start) / (segment.end - segment.start));

                return Math.max(completed, visualStart + local * (visualEnd - visualStart));
            }

            completed = Math.max(completed, visualEnd);
        }

        return completed;
    }

    function growPhase(t: number) {
        if (t <= 0) {
            return {
                peak: 0,
                scaleMix: 0,
                xMix: 0,
                yPeakMix: 0,
                settleMix: 0,
            };
        }

        if (t < 0.25) {
            const e = easeMotion(t / 0.25);

            return {
                peak: e,
                scaleMix: e,
                xMix: e,
                yPeakMix: e,
                settleMix: 0,
            };
        }

        if (t <= 0.3) {
            return {
                peak: 1,
                scaleMix: 1,
                xMix: 1,
                yPeakMix: 1,
                settleMix: 0,
            };
        }

        if (t < 0.75) {
            const e = easeMotion((t - 0.3) / 0.45);

            return {
                peak: 1 - e,
                scaleMix: 1 - e,
                xMix: 1 - e,
                yPeakMix: 1 - e,
                settleMix: e,
            };
        }

        return {
            peak: 0,
            scaleMix: 0,
            xMix: 0,
            yPeakMix: 0,
            settleMix: 1,
        };
    }

    function smoothstepBetween(start: number, end: number, value: number) {
        const x = clamp01((value - start) / Math.max(0.0001, end - start));

        return x * x * (3 - 2 * x);
    }

    /*
     * Classic Bloom v3.1
     *
     * This deliberately returns to the earlier letter-bound core + halo look.
     * The core rises quickly and stays crisp; the halo follows with a soft,
     * longer release. Everything is analytic in media time and opacity-only.
     */
    function glowPulse(t: number, attackStart: number, peak: number, releaseStart: number, releaseEnd: number) {
        return smoothstepBetween(attackStart, peak, t) * (1 - smoothstepBetween(releaseStart, releaseEnd, t));
    }

    function glowBucketSteps() {
        return 64;
    }

    function classicGlowEnergies(metrics: MotionMetrics, t: number, continuityGain: number, word: AnimatedWord) {
        const accent = currentAccent();
        const motionTime = Number.isFinite(t) ? t : 0;
        const continuity = Number.isFinite(continuityGain) ? clamp01(continuityGain) : 0;
        const shadowIntensity = Math.max(0, Number(metrics && metrics.shadowIntensity) || 0);
        const durationMs = Math.max(1, Number(word && word.motionDurationMs) || 1);
        const sustain = smoothstepBetween(700, 2200, durationMs);
        const rawEnergy = Math.max(0, shadowIntensity * accent.gain * (0.94 + 0.06 * sustain) * continuity);

        /* Soft knee keeps the highlight luminous without an OLED-white shelf. */
        const energy = 1 - Math.exp(-1.5 * rawEnergy);
        const spark = glowPulse(motionTime, 0, 0.1, 0.28, 0.56);
        const bloom = glowPulse(motionTime, 0.025, 0.19, 0.44, 0.8);
        const afterglow = glowPulse(motionTime, 0.11, 0.32, 0.6, 0.98);

        const core = energy * (0.88 * spark + 0.12 * bloom);
        const halo = energy * (0.74 * bloom + 0.26 * afterglow) * (0.82 + 0.1 * sustain);

        const load = core + 0.62 * halo;
        const limiter = Math.min(1, 1.08 / Math.max(0.0001, load));

        return {
            core: Math.min(0.9, core * limiter),
            halo: Math.min(0.76, halo * limiter),
        };
    }

    function setGlowLayers(owner: GlowOwner, layers: HTMLElement[] | undefined, core: number, halo: number) {
        const steps = glowBucketSteps();
        const coreBucket = Math.round(clamp01(core) * steps) / steps;
        const haloBucket = Math.round(clamp01(halo) * steps) / steps;

        if (owner._akGlowCoreBucket !== coreBucket) {
            owner._akGlowCoreBucket = coreBucket;
            if (layers && layers[0]) {
                layers[0].style.opacity = coreBucket.toFixed(3);
            }
        }

        if (owner._akGlowHaloBucket !== haloBucket) {
            owner._akGlowHaloBucket = haloBucket;
            if (layers && layers[1]) {
                layers[1].style.opacity = haloBucket.toFixed(3);
            }
        }
    }

    function motionContinuityGain(word: AnimatedWord, timelineTicks: number) {
        if (!word || word.motionMode !== "grow" || !Number.isFinite(word.end)) {
            return 1;
        }

        if (timelineTicks <= word.end) {
            return 1;
        }

        const after = timelineTicks - word.end;

        if (after >= MOTION_HANDOFF_TICKS) {
            return 0;
        }

        return 1 - easeMotion(after / MOTION_HANDOFF_TICKS);
    }

    function motionHandoffActive(word: AnimatedWord, timelineTicks: number) {
        return !!(
            word &&
            word.motionMode === "grow" &&
            Number.isFinite(word.end) &&
            Number.isFinite(word.start) &&
            timelineTicks >= word.start &&
            timelineTicks < word.end + MOTION_HANDOFF_TICKS
        );
    }

    function updateMotionGlyphs(word: AnimatedWord, timelineTicks: number, continuityGain = 1) {
        if (!word.motionGlyphs || !word.motionGlyphs.length) return;

        const durationTicks = Math.max(1, word.end - word.start);

        const animationTicks = durationTicks * 1.5;

        const delayPerGlyph = durationTicks * 0.09;

        word.motionGlyphs.forEach((glyph, index) => {
            const metrics = glyph._akMotion;

            if (!metrics) return;

            const t = (timelineTicks - word.start - delayPerGlyph * index) / animationTicks;

            const phase = growPhase(t);

            const glow = classicGlowEnergies(metrics, t, continuityGain, word);

            const scale = 1 + (metrics.maxScale - 1) * phase.scaleMix * continuityGain;

            const xEm = metrics.offsetXEm * phase.xMix * continuityGain;

            const yEm = (metrics.peakYEm * phase.yPeakMix + MOTION_FINAL_RISE_EM * phase.settleMix) * continuityGain;

            glyph.style.transform =
                `translate3d(${xEm.toFixed(4)}em, ${yEm.toFixed(4)}em, 0) ` + `scale3d(${scale.toFixed(4)}, ${scale.toFixed(4)}, 1)`;

            setGlowLayers(glyph, glyph.glowLayers, glow.core, glow.halo);

            word._akMotionIsReset = false;
        });
    }

    function updateWholeMotion(word: AnimatedWord, timelineTicks: number, continuityGain = 1) {
        if (!word.wholeMotion || !word.element) return;

        const durationTicks = Math.max(1, word.end - word.start);

        const animationTicks = durationTicks * 1.5;

        const t = (timelineTicks - word.start) / animationTicks;

        const phase = growPhase(t);

        const metrics = word.wholeMotion;

        const glow = classicGlowEnergies(metrics, t, continuityGain, word);

        const scale = 1 + (metrics.maxScale - 1) * phase.scaleMix * 0.78 * continuityGain;

        const yEm = (metrics.peakYEm * phase.yPeakMix * 0.82 + MOTION_FINAL_RISE_EM * phase.settleMix) * continuityGain;

        word.element.style.transform = `translate3d(0, ${yEm.toFixed(4)}em, 0) ` + `scale3d(${scale.toFixed(4)}, ${scale.toFixed(4)}, 1)`;

        if (!word._akWholeFilterCleared) {
            word.element.style.filter = "none";
            word._akWholeFilterCleared = true;
        }

        setGlowLayers(word, word.glowLayers, glow.core, glow.halo);

        word._akMotionIsReset = false;
    }

    function resetWordMotion(word: AnimatedWord) {
        if (!word || !word.element) {
            return;
        }

        word.element.classList.remove("ak-word-handoff");

        if (word._akMotionIsReset) return;

        word.element.style.transform = "";
        word.element.style.filter = "";
        (word.glowLayers || []).forEach((layer) => {
            layer.style.opacity = "0";
        });

        word._akGlowCoreBucket = 0;
        word._akGlowHaloBucket = 0;
        word._akWholeFilterCleared = false;

        (word.motionGlyphs || []).forEach((glyph) => {
            glyph.style.transform = "";

            (glyph.glowLayers || []).forEach((layer) => {
                layer.style.opacity = "0";
            });

            glyph._akGlowCoreBucket = 0;
            glyph._akGlowHaloBucket = 0;
        });

        word._akMotionIsReset = true;
    }

    function quantizedProgressPercent(word: AnimatedWord, painted: number) {
        return Math.round(painted * 1000) / 10;
    }

    function updateWordVisual(word: AnimatedWord, timelineTicks: number, frameNow: number) {
        if (!word || !word.element || !Array.isArray(word.segments) || !word.segments.length || !Number.isFinite(timelineTicks)) {
            return;
        }

        if (!Number.isFinite(word.start) || !Number.isFinite(word.end)) {
            setStaticWordState(word, "future", frameNow, false);
            return;
        }

        const motionEnd = word.motionMode === "grow" ? word.end + MOTION_HANDOFF_TICKS : word.end;

        if (timelineTicks <= word.start) {
            setStaticWordState(word, "future", frameNow, false);
            return;
        }

        if (timelineTicks >= motionEnd) {
            setStaticWordState(word, "past", frameNow, false);
            return;
        }

        word._akStaticState = "active";

        const rawTarget = wordTargetProgress(word, timelineTicks);

        const painted = smoothWordProgress(word, rawTarget, frameNow);

        const progressBucket = quantizedProgressPercent(word, painted);

        if (word._akProgressBucket !== progressBucket) {
            word._akProgressBucket = progressBucket;

            word.element.style.setProperty("--ak-word-progress", `${progressBucket.toFixed(1)}%`);
        }

        /*
         * At exactly 0% a feathered gradient would make the first few pixels
         * of EVERY upcoming word look pre-lit. Keep an unsung word solid gray
         * until real timing movement begins.
         */
        word.element.classList.toggle("ak-word-zero", painted <= ZERO_PROGRESS_EPSILON);

        const active = timelineTicks >= word.start && timelineTicks < word.end;

        const done = timelineTicks >= word.end;

        word.element.classList.toggle("ak-word-active", active);

        word.element.classList.toggle("ak-word-done", done);

        word.element.classList.toggle("ak-word-painted", done && painted >= 0.995);

        word.element.classList.remove("ak-word-next");

        if (word.motionMode === "grow") {
            const continuityGain = motionContinuityGain(word, timelineTicks);

            if (word.motionGlyphs && word.motionGlyphs.length) {
                updateMotionGlyphs(word, timelineTicks, continuityGain);
            } else {
                updateWholeMotion(word, timelineTicks, continuityGain);
            }
        }
    }

    function setStaticWordState(word: AnimatedWord, stateName: string, frameNow: number, preserveMotion = false) {
        if (!word || !word.element || !Array.isArray(word.segments) || !word.segments.length) {
            return;
        }

        if (word._akStaticState === stateName) {
            if (!preserveMotion) {
                resetWordMotion(word);
            }
            return;
        }

        word._akStaticState = stateName;

        if (stateName === "past") {
            word.visualProgress = 1;
            word.lastPaintAt = frameNow;
            word._akProgressBucket = 100;

            word.element.style.setProperty("--ak-word-progress", "100%");

            word.element.classList.remove("ak-word-zero", "ak-word-active", "ak-word-next");

            word.element.classList.add("ak-word-done", "ak-word-painted");
        } else if (stateName === "future") {
            word.visualProgress = 0;
            word.lastPaintAt = frameNow;
            word._akProgressBucket = 0;

            word.element.style.setProperty("--ak-word-progress", "0%");

            word.element.classList.add("ak-word-zero");

            word.element.classList.remove("ak-word-active", "ak-word-done", "ak-word-painted", "ak-word-next");
        } else {
            word._akStaticState = "active";
        }

        if (!preserveMotion) {
            resetWordMotion(word);
        }
    }

    return {
        wordTargetProgress,
        smoothstepBetween,
        glowBucketSteps,
        motionContinuityGain,
        motionHandoffActive,
        updateMotionGlyphs,
        updateWholeMotion,
        resetWordMotion,
        updateWordVisual,
        setStaticWordState,
    };
}
