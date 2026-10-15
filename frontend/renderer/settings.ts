/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
/** Shared animation, artwork and preference policy for the supported renderer. */

export const TICKS_PER_SECOND = 10000000;
export const LYRIC_VISUAL_WATCHDOG_MS = 700;
export const LYRIC_FRAME_RECOVERY_MS = 36;
export const UNIFIED_RENDERER_SIGNATURE = "unified-pc-mobile-v3:60fps:multiscript-shaped-wipe:classic-bloom64:atmo-dynamic-kawarp-v325-hotfix";
export const LINE_CLASS_NEIGHBORHOOD = 6;
export const ATMOSPHERE_ART_MAX_WIDTH = 720;
export const DYNAMIC_BACKGROUND_SOURCE = "chengggit Dynamic Background 3.2.4 + Better Lyrics Kawarp";
export const DYNAMIC_BACKGROUND_ENGINE = "kawarp-domain-warp-hardened";
export const DYNAMIC_BACKGROUND_TRANSITION_MS = 260;
export const DYNAMIC_BACKGROUND_DOM_STABLE_MS = 900;
export const DYNAMIC_BACKGROUND_UNBOUND_DOM_CONFIRM_MS = 1500;
export const DYNAMIC_BACKGROUND_INHERITED_DOM_STABLE_MS = 0;
export const DYNAMIC_BACKGROUND_INHERITED_DOM_CONFIRM_MS = 0;
export const DYNAMIC_BACKGROUND_DIRECT_GRACE_MS = 700;
export const DYNAMIC_BACKGROUND_DIRECT_LOAD_TIMEOUT_MS = 900;
export const DYNAMIC_BACKGROUND_WEAK_RECHECK_MS = 12000;
export const DYNAMIC_BACKGROUND_NO_ART_CONFIRM_MS = 2500;
export const DYNAMIC_BACKGROUND_NO_ART_RETRY_MS = 10000;
export const DYNAMIC_BACKGROUND_DIRECT_RETRY_MS = 1500;
export const DYNAMIC_BACKGROUND_WEBGL_RETRY_BASE_MS = 30000;
export const DYNAMIC_BACKGROUND_WEBGL_RETRY_MAX_MS = 300000;
export const DYNAMIC_BACKGROUND_SETTINGS = Object.freeze({
    opacity: 0.75,
    warpIntensity: 1.0,
    blurPasses: 8,
    blurSize: 128,
    animationSpeed: 1.8,
    transitionDuration: DYNAMIC_BACKGROUND_TRANSITION_MS,
    saturation: 1.7,
    dithering: 0,
    tintColor: [0.157, 0.157, 0.235],
    tintIntensity: 0.15,
    scale: 1.0,
    audioResponsive: false,
    pauseOnInactive: true,
});
export const PERFORMANCE_STORAGE_KEY = "lyricbridge.renderer.performance";
export const SONG_PREFERENCES_STORAGE_KEY = "lyricbridge.renderer.songs";
export const GOOGLE_ROMANIZATION_CACHE_MAX_ENTRIES = 1800;
export const GOOGLE_ROMANIZATION_MAX_TEXT_CHARS = 1500;
export const GOOGLE_ROMANIZATION_MAX_RETRIES = 3;
export const GOOGLE_ROMANIZATION_RETRY_DELAY_MS = 1000;
export const GOOGLE_ROMANIZATION_TIMEOUT_MS = 6000;
export const GOOGLE_ROMANIZATION_CONCURRENCY = 3;
export const TIMING_OFFSET_FINE_STEP_SECONDS = 0.1;
export const TIMING_OFFSET_STEP_SECONDS = 0.5;
export const TIMING_OFFSET_MIN_SECONDS = -15;
export const TIMING_OFFSET_MAX_SECONDS = 15;
export const SONG_PREFERENCES_MAX_ENTRIES = 300;
export const PERFORMANCE_TARGET_FPS = Object.freeze({
    desktop: 60,
    mobile: 60,
});
export const LRC_TARGET_FPS = 20;
export const PAUSED_TARGET_FPS = 2;
export const DECORATION_RETRY_MS = 120;
export const DECORATION_RETRY_WINDOW_MS = 6000;
export const MEDIA_DISCOVERY_RETRY_MS = 250;
export const ATMOSPHERE_IMAGE_TIMEOUT_MS = 6500;
export const ACCENT_STORAGE_KEY = "lyricbridge.renderer.accent";
export const ACCENT_HISTORY_STORAGE_KEY = "lyricbridge.renderer.recentAccents";
export const PREMIUM_ACCENTS = Object.freeze([
    { id: "ruby", name: "Ruby", rgb: "255, 62, 102", secondaryRgb: "255, 112, 72", tertiaryRgb: "226, 78, 255", gain: 0.99 },
    { id: "solar-yellow", name: "Solar Yellow", rgb: "255, 232, 62", secondaryRgb: "255, 142, 48", tertiaryRgb: "48, 242, 220", gain: 0.49 },
    { id: "emerald", name: "Emerald", rgb: "48, 246, 158", secondaryRgb: "52, 255, 214", tertiaryRgb: "148, 94, 255", gain: 0.55 },
    { id: "sapphire", name: "Sapphire Blue", rgb: "66, 136, 255", secondaryRgb: "72, 222, 255", tertiaryRgb: "255, 92, 194", gain: 0.82 },
    { id: "electric-violet", name: "Electric Violet", rgb: "152, 76, 255", secondaryRgb: "82, 172, 255", tertiaryRgb: "72, 255, 228", gain: 1.0 },
]);
export const NEUTRAL_ACCENT = Object.freeze({
    id: "neutral-fallback",
    name: "Neutral Fallback",
    rgb: "214, 226, 255",
    secondaryRgb: "196, 180, 255",
    tertiaryRgb: "255, 214, 238",
    gain: 0.72,
});
