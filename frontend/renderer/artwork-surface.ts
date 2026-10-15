import { DYNAMIC_BACKGROUND_SETTINGS, DYNAMIC_BACKGROUND_WEBGL_RETRY_BASE_MS, DYNAMIC_BACKGROUND_WEBGL_RETRY_MAX_MS } from "./settings.ts";
/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
import { requireValue } from "../shared/invariants.ts";
import { Lifecycle } from "../shared/lifecycle.ts";
import type {} from "../shared/runtime.ts";
import { DynamicBackgroundRenderer } from "./background-engine.ts";
import { directChildByClass, removeNode } from "./dom.ts";
import { getCurrentLyricPage, isLyricsPage } from "./host.ts";
import type { ArtworkFingerprint } from "./models.ts";
import type { RendererState } from "./state.ts";

interface OwnedState {
    atmosphereRoot: HTMLElement | null;
    atmosphereDynamicCanvas: HTMLCanvasElement | null;
    atmosphereDynamicFingerprintFailures: number;
    atmosphereDynamicRenderer: DynamicBackgroundRenderer | null;
    atmosphereDynamicWebglAvailable: boolean | null;
    atmosphereDynamicWebglFailureCount: number;
    atmosphereDynamicWebglRetryAt: number;
    atmosphereDynamicCurrentArtwork: string;
    atmosphereDynamicCurrentFingerprint: ArtworkFingerprint | null;
    atmosphereDynamicBaseIndex: number;
    atmosphereArtwork: string;
    atmosphereSource: string;
    atmosphereDynamicVisualDedupCount: number;
}
interface Dependencies {
    state: Pick<RendererState, "lyricViewHidden" | "performanceProfile" | "mediaElement">;
    applyPerformanceClassToPage: (page: HTMLElement | null) => void;
    lifecycle: Lifecycle;
    prefersReducedMotion: () => boolean;
    preloadAtmosphereImage: (url: string) => Promise<HTMLImageElement>;
}
export function createArtworkSurface({ state, applyPerformanceClassToPage, lifecycle, prefersReducedMotion, preloadAtmosphereImage }: Dependencies) {
    let loadGeneration = 0;
    const owned: OwnedState = {
        atmosphereRoot: null,
        atmosphereDynamicCanvas: null,
        atmosphereDynamicFingerprintFailures: 0,
        atmosphereDynamicRenderer: null,
        atmosphereDynamicWebglAvailable: null,
        atmosphereDynamicWebglFailureCount: 0,
        atmosphereDynamicWebglRetryAt: 0,
        atmosphereDynamicCurrentArtwork: "",
        atmosphereDynamicCurrentFingerprint: null,
        atmosphereDynamicBaseIndex: 0,
        atmosphereArtwork: "",
        atmosphereSource: "none",
        atmosphereDynamicVisualDedupCount: 0,
    };
    function getAtmospherePage() {
        if (!isLyricsPage()) return null;
        return getCurrentLyricPage();
    }

    function removeAtmosphereRoot(source: string = "remove-root") {
        const root = owned.atmosphereRoot;
        const parent = root && root.parentElement;
        disposeDynamicBackgroundRenderer(source);
        if (root) removeNode(root);
        if (parent && parent.classList) {
            parent.classList.remove("ak-atmosphere-host");
        }
        owned.atmosphereRoot = null;
        document.documentElement.classList.remove("ak-atmosphere-dynamic-mode");
        document.documentElement.classList.remove("ak-lyricmotion-atmosphere-active");
    }

    function ensureAtmosphereRoot() {
        const page = getAtmospherePage();
        if (!page) {
            removeAtmosphereRoot("no-page");
            return null;
        }

        if (owned.atmosphereRoot && owned.atmosphereRoot.isConnected && owned.atmosphereRoot.parentNode === page) {
            document.documentElement.classList.add("ak-lyricmotion-atmosphere-active");
            document.documentElement.classList.add("ak-atmosphere-dynamic-mode");
            startDynamicBackgroundRenderer();
            return owned.atmosphereRoot;
        }

        if (owned.atmosphereRoot && owned.atmosphereRoot.isConnected && owned.atmosphereRoot.parentNode !== page) {
            const staleParent = owned.atmosphereRoot.parentElement;
            disposeDynamicBackgroundRenderer("stale-page-root");
            removeNode(owned.atmosphereRoot);
            if (staleParent && staleParent.classList) {
                staleParent.classList.remove("ak-atmosphere-host");
            }
            owned.atmosphereRoot = null;
        }

        const old = directChildByClass(page, "ak-atmosphere");
        if (old && owned.atmosphereDynamicCanvas && old.contains && old.contains(owned.atmosphereDynamicCanvas)) {
            disposeDynamicBackgroundRenderer("root-replaced");
        }
        removeNode(old);

        const root = document.createElement("div");
        root.className = "ak-atmosphere";
        root.setAttribute("aria-hidden", "true");
        root.dataset.akMode = "dynamic";

        for (let index = 0; index < 2; index += 1) {
            const fallback = document.createElement("div");
            fallback.className = `ak-atmosphere-dynamic-fallback ak-atmosphere-dynamic-fallback-${index === 0 ? "a" : "b"}`;
            fallback.dataset.akDynamicFallback = String(index);
            root.appendChild(fallback);
        }

        const canvas = document.createElement("canvas");
        canvas.className = "ak-atmosphere-dynamic-canvas";
        canvas.setAttribute("aria-hidden", "true");
        root.appendChild(canvas);

        const shade = document.createElement("div");
        shade.className = "ak-atmosphere-dynamic-shade";
        root.appendChild(shade);

        page.insertBefore(root, page.firstChild);
        page.classList.add("ak-atmosphere-host");
        document.documentElement.classList.add("ak-lyricmotion-atmosphere-active");
        document.documentElement.classList.add("ak-atmosphere-dynamic-mode");
        applyPerformanceClassToPage(page);
        owned.atmosphereRoot = root;
        startDynamicBackgroundRenderer();
        return root;
    }

    function dynamicArtworkFingerprintFromPixels(data: Uint8ClampedArray, width: number, height: number) {
        const w = Math.max(1, Math.floor(Number(width) || 0));
        const h = Math.max(1, Math.floor(Number(height) || 0));
        if (!data || data.length < w * h * 4) return null;
        const rgb = new Uint8Array(w * h * 3);
        const luma = new Float32Array(w * h);
        const edges = [];
        let rgbIndex = 0;
        let meanR = 0,
            meanG = 0,
            meanB = 0;
        let hash = 2166136261;
        for (let index = 0; index < w * h; index += 1) {
            const source = index * 4;
            const alpha = Math.max(0, Math.min(255, Number(data[source + 3]) || 0)) / 255;
            const r = Math.round((Number(data[source]) || 0) * alpha);
            const g = Math.round((Number(data[source + 1]) || 0) * alpha);
            const b = Math.round((Number(data[source + 2]) || 0) * alpha);
            rgb[rgbIndex++] = r;
            rgb[rgbIndex++] = g;
            rgb[rgbIndex++] = b;
            meanR += r;
            meanG += g;
            meanB += b;
            luma[index] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            for (const value of [r >> 3, g >> 3, b >> 3]) {
                hash ^= value;
                hash = Math.imul(hash, 16777619);
            }
        }
        for (let y = 0; y < h; y += 1) {
            for (let x = 0; x < w; x += 1) {
                const index = y * w + x;
                if (x + 1 < w) edges.push(requireValue(luma[index + 1]) - requireValue(luma[index]));
                if (y + 1 < h) edges.push(requireValue(luma[index + w]) - requireValue(luma[index]));
            }
        }
        const count = w * h;
        return {
            width: w,
            height: h,
            hash: (hash >>> 0).toString(16).padStart(8, "0"),
            rgb,
            edges: Float32Array.from(edges),
            mean: [meanR / count, meanG / count, meanB / count],
        };
    }

    function dynamicArtworkFingerprint(image: HTMLImageElement | HTMLVideoElement | null) {
        if (!image) return null;
        try {
            const size = 24;
            const canvas = document.createElement("canvas");
            canvas.width = size;
            canvas.height = size;
            const context = canvas.getContext && canvas.getContext("2d", { willReadFrequently: true });
            if (!context) return null;
            const iw = Number((image instanceof HTMLVideoElement ? image.videoWidth : image.naturalWidth) || image.width || size);
            const ih = Number((image instanceof HTMLVideoElement ? image.videoHeight : image.naturalHeight) || image.height || size);
            const scale = Math.max(size / Math.max(1, iw), size / Math.max(1, ih));
            const dw = iw * scale,
                dh = ih * scale;
            context.clearRect(0, 0, size, size);
            context.drawImage(image, (size - dw) * 0.5, (size - dh) * 0.5, dw, dh);
            const pixels = context.getImageData(0, 0, size, size);
            return dynamicArtworkFingerprintFromPixels(pixels.data, size, size);
        } catch {
            owned.atmosphereDynamicFingerprintFailures += 1;
            return null;
        }
    }

    function dynamicArtworkFingerprintsEquivalent(first: ArtworkFingerprint | null, second: ArtworkFingerprint | null) {
        if (!first || !second || first.width !== second.width || first.height !== second.height) return false;
        if (first.hash && second.hash && first.hash === second.hash) return true;
        if (!first.rgb || !second.rgb || first.rgb.length !== second.rgb.length) return false;
        if (!first.edges || !second.edges || first.edges.length !== second.edges.length) return false;
        let colorDifference = 0;
        for (let index = 0; index < first.rgb.length; index += 1)
            colorDifference += Math.abs(requireValue(first.rgb[index]) - requireValue(second.rgb[index]));
        const colorMad = colorDifference / first.rgb.length;
        let meanDifference = 0;
        for (let index = 0; index < 3; index += 1) meanDifference += Math.abs(requireValue(first.mean[index]) - requireValue(second.mean[index]));
        meanDifference /= 3;
        let edgeDifference = 0;
        for (let index = 0; index < first.edges.length; index += 1)
            edgeDifference += Math.abs(requireValue(first.edges[index]) - requireValue(second.edges[index]));
        const edgeMad = edgeDifference / Math.max(1, first.edges.length);
        return colorMad <= 4.5 && meanDifference <= 4.0 && edgeMad <= 8.0;
    }

    function updateAtmospherePlaybackState(media: HTMLMediaElement | null) {
        const renderer = owned.atmosphereDynamicRenderer;
        if (!renderer) return;

        if (!media || media.paused || media.ended || document.hidden || state.lyricViewHidden || !isLyricsPage() || prefersReducedMotion()) {
            renderer.stop();
            return;
        }

        renderer.start();
    }

    function dynamicBackgroundRendererOptions() {
        const mobile = state.performanceProfile === "mobile";
        return {
            ...DYNAMIC_BACKGROUND_SETTINGS,
            renderScale: mobile ? 0.65 : 0.75,
            maxRenderLongEdge: mobile ? 960 : 1600,
            maxFps: 30,
            maxWarpLongEdge: mobile ? 480 : 800,
            onContextLost: () => {
                const root = owned.atmosphereRoot;
                if (root) {
                    /* A lost context cannot paint the canvas. Remove the ready
                     * flag as well as showing fallback; otherwise the later
                     * ready rule can still hide the fallback layers. */
                    root.classList.remove("ak-dynamic-webgl-ready");
                    root.classList.add("ak-dynamic-fallback-active");
                }
            },
            onContextRestored: () => {
                rebuildDynamicBackgroundRenderer("context-restored");
            },
        };
    }

    function dynamicRendererHasCurrentTexture(renderer: DynamicBackgroundRenderer | null) {
        return !!(renderer && renderer.hasCurrent && !renderer.contextLost);
    }

    function markDynamicBackgroundWebglReady(root: HTMLElement | null, renderer: DynamicBackgroundRenderer | null) {
        if (!root || !dynamicRendererHasCurrentTexture(renderer)) {
            return false;
        }

        /* A constructor alone does not prove that the canvas can show the
         * artwork. Only hide the CSS fallback after a texture is current. */
        owned.atmosphereDynamicWebglAvailable = true;
        owned.atmosphereDynamicWebglFailureCount = 0;
        owned.atmosphereDynamicWebglRetryAt = 0;
        root.classList.add("ak-dynamic-webgl-ready");
        root.classList.remove("ak-dynamic-fallback-active");
        return true;
    }

    function recordDynamicBackgroundWebglFailure(root: HTMLElement | null) {
        const now = performance.now();
        const canvas = (root && directChildByClass(root, "ak-atmosphere-dynamic-canvas")) || owned.atmosphereDynamicCanvas;

        /* A failed upload can leave a renderer without a usable texture.
         * Dispose it so a due retry creates a clean context, but retain the
         * canvas identity so ensureDynamicBackgroundRenderer() honors backoff. */
        disposeDynamicBackgroundRenderer("webgl-failure");
        if (canvas instanceof HTMLCanvasElement) owned.atmosphereDynamicCanvas = canvas;

        owned.atmosphereDynamicWebglAvailable = false;
        owned.atmosphereDynamicWebglFailureCount += 1;
        owned.atmosphereDynamicWebglRetryAt =
            now +
            Math.min(
                DYNAMIC_BACKGROUND_WEBGL_RETRY_MAX_MS,
                DYNAMIC_BACKGROUND_WEBGL_RETRY_BASE_MS * Math.pow(2, Math.min(3, owned.atmosphereDynamicWebglFailureCount - 1)),
            );

        if (root) {
            root.classList.remove("ak-dynamic-webgl-ready");
            root.classList.add("ak-dynamic-fallback-active");
        }

        return null;
    }

    function loadDynamicBackgroundRendererImage(
        root: HTMLElement | null,
        renderer: DynamicBackgroundRenderer | null,
        image: HTMLImageElement | null,
    ) {
        try {
            const loaded = renderer && image && renderer.loadImageElement(image);

            if (!loaded || !markDynamicBackgroundWebglReady(root, renderer)) {
                throw new Error("WebGL artwork texture did not become current.");
            }

            if (prefersReducedMotion() || document.hidden) {
                renderer.renderFrame();
            } else {
                renderer.start();
            }

            return true;
        } catch {
            recordDynamicBackgroundWebglFailure(root);
            return false;
        }
    }

    function ensureDynamicBackgroundRenderer() {
        const root = owned.atmosphereRoot && owned.atmosphereRoot.isConnected ? owned.atmosphereRoot : ensureAtmosphereRoot();
        if (!root) return null;
        const canvas = directChildByClass(root, "ak-atmosphere-dynamic-canvas");
        if (!(canvas instanceof HTMLCanvasElement)) return null;
        if (owned.atmosphereDynamicRenderer && owned.atmosphereDynamicCanvas === canvas) {
            if (dynamicRendererHasCurrentTexture(owned.atmosphereDynamicRenderer)) {
                markDynamicBackgroundWebglReady(root, owned.atmosphereDynamicRenderer);
            } else {
                root.classList.remove("ak-dynamic-webgl-ready");
                root.classList.add("ak-dynamic-fallback-active");
            }
            return owned.atmosphereDynamicRenderer;
        }

        const now = performance.now();
        const previousCanvas = owned.atmosphereDynamicCanvas;
        if (previousCanvas && previousCanvas !== canvas) {
            owned.atmosphereDynamicWebglFailureCount = 0;
            owned.atmosphereDynamicWebglRetryAt = 0;
        } else if (previousCanvas === canvas && owned.atmosphereDynamicWebglAvailable === false && now < owned.atmosphereDynamicWebglRetryAt) {
            return null;
        }

        disposeDynamicBackgroundRenderer("renderer-recreate");
        owned.atmosphereDynamicCanvas = canvas;
        /* The CSS artwork remains the visible field until loadImageElement()
         * has successfully populated a current WebGL texture. */
        root.classList.remove("ak-dynamic-webgl-ready");
        root.classList.add("ak-dynamic-fallback-active");
        try {
            const renderer = new DynamicBackgroundRenderer(canvas, dynamicBackgroundRendererOptions(), {
                lifecycle,
                isVisible: () => !document.hidden && !state.lyricViewHidden && isLyricsPage(),
                isPaused: () => !!(state.mediaElement?.paused || state.mediaElement?.ended),
                reducedMotion: prefersReducedMotion,
            });
            owned.atmosphereDynamicRenderer = renderer;
            owned.atmosphereDynamicWebglAvailable = true;
            renderer.resizeToDisplaySize();
            return renderer;
        } catch {
            return recordDynamicBackgroundWebglFailure(root);
        }
    }

    function startDynamicBackgroundRenderer() {
        if (document.hidden || prefersReducedMotion()) return false;
        const renderer = owned.atmosphereDynamicRenderer || ensureDynamicBackgroundRenderer();
        if (!renderer) return false;
        renderer.start();
        return true;
    }

    function stopDynamicBackgroundRenderer(source: string = "stop") {
        if (owned.atmosphereDynamicRenderer) owned.atmosphereDynamicRenderer.stop();
        return source;
    }

    function disposeDynamicBackgroundRenderer(source: string = "dispose") {
        const renderer = owned.atmosphereDynamicRenderer;
        owned.atmosphereDynamicRenderer = null;
        if (renderer) {
            try {
                renderer.dispose();
            } catch {
                /* context can already be lost */
            }
        }
        owned.atmosphereDynamicCanvas = null;
        return source;
    }

    function rebuildDynamicBackgroundRenderer(source: string = "rebuild") {
        const artwork = owned.atmosphereDynamicCurrentArtwork;
        const fingerprint = owned.atmosphereDynamicCurrentFingerprint;
        disposeDynamicBackgroundRenderer(source);
        if (!isLyricsPage()) return null;
        const renderer = ensureDynamicBackgroundRenderer();
        if (!renderer || !artwork) return renderer;
        const rebuildSeq = loadGeneration;
        preloadAtmosphereImage(artwork)
            .then((image) => {
                if (!isLyricsPage() || rebuildSeq !== loadGeneration || artwork !== owned.atmosphereDynamicCurrentArtwork) return;
                const current = owned.atmosphereDynamicRenderer;
                if (!current) return;
                if (loadDynamicBackgroundRendererImage(owned.atmosphereRoot, current, image)) {
                    if (fingerprint) owned.atmosphereDynamicCurrentFingerprint = fingerprint;
                }
            })
            .catch(() => {
                if (!isLyricsPage() || rebuildSeq !== loadGeneration || artwork !== owned.atmosphereDynamicCurrentArtwork) {
                    return;
                }

                recordDynamicBackgroundWebglFailure(owned.atmosphereRoot);
            });
        return renderer;
    }

    function resizeDynamicBackgroundRenderer() {
        const renderer = owned.atmosphereDynamicRenderer;
        if (!renderer) return false;
        try {
            const changed = renderer.resizeToDisplaySize();
            if (changed) {
                renderer.renderFrame();
            }
            return changed;
        } catch {
            return false;
        }
    }

    function dynamicFallbackLayer(root: HTMLElement | null, index: number) {
        if (!root || !root.children) return null;
        return (
            Array.from(root.children).find(
                (child): child is HTMLElement => child instanceof HTMLElement && child.dataset.akDynamicFallback === String(index),
            ) || null
        );
    }

    function updateDynamicFallbackSameVisual(artworkUrl: string) {
        const root = owned.atmosphereRoot;
        const active = dynamicFallbackLayer(root, owned.atmosphereDynamicBaseIndex);
        if (active && artworkUrl) active.style.backgroundImage = `url(${JSON.stringify(artworkUrl)})`;
    }

    function setDynamicFallbackArtwork(artworkUrl: string) {
        const root = owned.atmosphereRoot;
        if (!root) return;
        if (!artworkUrl) {
            for (const index of [0, 1]) {
                const layer = dynamicFallbackLayer(root, index);
                if (!layer) continue;
                layer.classList.remove("ak-dynamic-fallback-active-layer");
                layer.style.backgroundImage = "none";
            }
            return;
        }
        const nextIndex = owned.atmosphereDynamicBaseIndex === 0 ? 1 : 0;
        const next = dynamicFallbackLayer(root, nextIndex);
        const old = dynamicFallbackLayer(root, owned.atmosphereDynamicBaseIndex);
        if (!next) return;
        next.style.backgroundImage = `url(${JSON.stringify(artworkUrl)})`;
        next.classList.remove("ak-dynamic-fallback-active-layer");
        void next.offsetWidth;
        next.classList.add("ak-dynamic-fallback-active-layer");
        if (old && old !== next) old.classList.remove("ak-dynamic-fallback-active-layer");
        owned.atmosphereDynamicBaseIndex = nextIndex;
    }

    function activateDynamicBackgroundAtmosphere(
        image: HTMLImageElement | null,
        artworkUrl: string,
        source: string,
        artworkFingerprint: ArtworkFingerprint | null = null,
    ) {
        const root = ensureAtmosphereRoot();
        if (!root) return false;
        root.dataset.akMode = "dynamic";
        document.documentElement.classList.add("ak-atmosphere-dynamic-mode");

        const sameUrl = !!artworkUrl && artworkUrl === owned.atmosphereDynamicCurrentArtwork;
        const comparable = !!artworkFingerprint && !!owned.atmosphereDynamicCurrentFingerprint;
        const sameVisual = comparable && dynamicArtworkFingerprintsEquivalent(artworkFingerprint, owned.atmosphereDynamicCurrentFingerprint);
        const sameArtwork = comparable ? sameVisual : sameUrl;

        if (!artworkUrl || !image) {
            setDynamicFallbackArtwork("");
            owned.atmosphereDynamicCurrentArtwork = "";
            owned.atmosphereDynamicCurrentFingerprint = null;
            owned.atmosphereArtwork = "";
            owned.atmosphereSource = source || "no-artwork";
            const renderer = owned.atmosphereDynamicRenderer;
            if (renderer) renderer.stop();
            root.classList.remove("ak-dynamic-webgl-ready");
            root.classList.add("ak-dynamic-fallback-active");
            root.classList.add("ak-atmosphere-ready");
            return true;
        }

        if (sameArtwork) {
            if (sameVisual && !sameUrl) owned.atmosphereDynamicVisualDedupCount += 1;
            /* Same album, different track-specific URL: update only recovery URL
             * metadata. A healthy current texture is left entirely untouched;
             * an earlier WebGL failure is eligible to recover once its backoff
             * expires. */
            updateDynamicFallbackSameVisual(artworkUrl);
            owned.atmosphereDynamicCurrentArtwork = artworkUrl;
            if (artworkFingerprint) owned.atmosphereDynamicCurrentFingerprint = artworkFingerprint;
            owned.atmosphereArtwork = artworkUrl;
            owned.atmosphereSource = `${source || "unknown"}+same-visual-reuse`;
            root.classList.add("ak-atmosphere-ready");
            const existing = owned.atmosphereDynamicRenderer;
            if (dynamicRendererHasCurrentTexture(existing)) {
                markDynamicBackgroundWebglReady(root, existing);
                if (!document.hidden && !prefersReducedMotion()) requireValue(existing).start();
                return false;
            }

            root.classList.remove("ak-dynamic-webgl-ready");
            root.classList.add("ak-dynamic-fallback-active");

            const retryAt = Number(owned.atmosphereDynamicWebglRetryAt) || 0;
            if (retryAt && performance.now() < retryAt) return false;

            const retryRenderer = ensureDynamicBackgroundRenderer();
            if (retryRenderer) {
                loadDynamicBackgroundRendererImage(root, retryRenderer, image);
            }

            return false;
        }

        setDynamicFallbackArtwork(artworkUrl);
        owned.atmosphereDynamicCurrentArtwork = artworkUrl;
        owned.atmosphereDynamicCurrentFingerprint = artworkFingerprint || null;
        const renderer = ensureDynamicBackgroundRenderer();
        if (renderer) {
            loadDynamicBackgroundRendererImage(root, renderer, image);
        } else {
            root.classList.add("ak-dynamic-fallback-active");
        }

        owned.atmosphereArtwork = artworkUrl;
        owned.atmosphereSource = `${source || "unknown"}+dynamic-background`;
        root.classList.add("ak-atmosphere-ready");
        return true;
    }

    return {
        removeAtmosphereRoot,
        ensureAtmosphereRoot,
        dynamicArtworkFingerprint,
        activateDynamicBackgroundAtmosphere,
        updateAtmospherePlaybackState,
        startDynamicBackgroundRenderer,
        stopDynamicBackgroundRenderer,
        rebuildDynamicBackgroundRenderer,
        resizeDynamicBackgroundRenderer,
        get webglRetryAt() {
            return owned.atmosphereDynamicWebglRetryAt;
        },
        get needsWebglRecovery() {
            return owned.atmosphereDynamicWebglAvailable === false || !dynamicRendererHasCurrentTexture(owned.atmosphereDynamicRenderer);
        },
        invalidateLoads() {
            loadGeneration++;
        },
        get root() {
            return owned.atmosphereRoot;
        },
        get artwork() {
            return owned.atmosphereArtwork;
        },
        diagnostics: () => ({ ...owned }),
    };
}
