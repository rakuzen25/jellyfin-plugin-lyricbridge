/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
import { requireValue } from "../shared/invariants.ts";
import type {} from "../shared/runtime.ts";
import { ArtworkLoader } from "./artwork-loader.ts";
import { DynamicBackgroundRenderer } from "./background-engine.ts";
import { directChildByClass, removeNode } from "./dom.ts";
import { getCurrentLyricPage, isLyricsPage } from "./host.ts";
import { RendererLifecycle } from "./lifecycle.ts";
import type { ArtworkCandidate, ArtworkFingerprint } from "./models.ts";
import type { RendererState } from "./state.ts";
function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

interface Dependencies {
    state: Pick<
        RendererState,
        | "atmosphereRoot"
        | "atmosphereDynamicCanvas"
        | "atmosphereMode"
        | "atmosphereLastCheck"
        | "atmosphereArtwork"
        | "atmosphereSource"
        | "atmosphereLoadSeq"
        | "atmospherePendingKey"
        | "atmospherePendingSince"
        | "atmosphereDynamicProbeTimers"
        | "atmosphereDynamicProbeToken"
        | "lyricsAcceptedKey"
        | "lyricsRequestKey"
        | "atmosphereDynamicFingerprintFailures"
        | "atmosphereDynamicRenderer"
        | "lyricViewHidden"
        | "performanceProfile"
        | "atmosphereDynamicContextLossCount"
        | "atmosphereDynamicFallbackReason"
        | "atmosphereDynamicInterruptedTransitions"
        | "atmosphereDynamicTransitionCount"
        | "atmosphereDynamicWebglAvailable"
        | "atmosphereDynamicWebglFailureCount"
        | "atmosphereDynamicWebglRetryAt"
        | "mediaElement"
        | "atmosphereDynamicResizeCount"
        | "atmosphereDynamicCurrentArtwork"
        | "atmosphereDynamicCurrentFingerprint"
        | "atmosphereDynamicBaseIndex"
        | "atmosphereDynamicIdentityMethod"
        | "atmosphereDynamicVisualDedupCount"
        | "atmosphereAnalysis"
        | "atmosphereDynamicStaleCommitDrops"
        | "atmosphereMediaKey"
        | "atmosphereDynamicDomBaseline"
        | "atmosphereDynamicResolvedKey"
        | "atmosphereDynamicResolvedAt"
        | "atmosphereDynamicNoArtwork"
        | "atmosphereDynamicNoArtFailures"
        | "atmosphereDynamicDirectRetryAt"
        | "atmosphereDynamicDomCandidateSinceByUrl"
        | "atmosphereDynamicMediaStableSince"
        | "atmosphereDynamicWeakSource"
        | "atmosphereFailedKey"
        | "atmosphereFailedAt"
        | "atmosphereDynamicDomFallbackCommits"
        | "atmosphereDynamicFastInheritedCommits"
        | "atmosphereDynamicDirectLoadFailures"
    >;
    applyPerformanceClassToPage: (page: HTMLElement | null) => void;
    wakeAnimationLoop: () => void;
    artworkLoader: ArtworkLoader<HTMLImageElement>;
    lifecycle: RendererLifecycle;
    getLocalMediaElement: (forceProbe?: boolean) => HTMLMediaElement | null;
    warn: (...args: unknown[]) => void;
    ATMOSPHERE_ART_MAX_WIDTH: 720;
    DYNAMIC_BACKGROUND_DOM_STABLE_MS: 900;
    DYNAMIC_BACKGROUND_UNBOUND_DOM_CONFIRM_MS: 1500;
    DYNAMIC_BACKGROUND_INHERITED_DOM_STABLE_MS: 0;
    DYNAMIC_BACKGROUND_INHERITED_DOM_CONFIRM_MS: 0;
    ATMOSPHERE_IMAGE_TIMEOUT_MS: 6500;
    prefersReducedMotion: () => boolean;
    DYNAMIC_BACKGROUND_SETTINGS: Readonly<{
        opacity: 0.75;
        warpIntensity: 1;
        blurPasses: 8;
        blurSize: 128;
        animationSpeed: 1.8;
        transitionDuration: 260;
        saturation: 1.7;
        dithering: 0;
        tintColor: number[];
        tintIntensity: 0.15;
        scale: 1;
        audioResponsive: false;
        pauseOnInactive: true;
    }>;
    DYNAMIC_BACKGROUND_WEBGL_RETRY_MAX_MS: 300000;
    DYNAMIC_BACKGROUND_WEBGL_RETRY_BASE_MS: 30000;
    DYNAMIC_BACKGROUND_SOURCE: "chengggit Dynamic Background 3.2.4 + Better Lyrics Kawarp";
    DYNAMIC_BACKGROUND_ENGINE: "kawarp-domain-warp-hardened";
    DYNAMIC_BACKGROUND_TRANSITION_MS: 260;
    DYNAMIC_BACKGROUND_WEAK_RECHECK_MS: 12000;
    DYNAMIC_BACKGROUND_NO_ART_RETRY_MS: 10000;
    DYNAMIC_BACKGROUND_DIRECT_GRACE_MS: 700;
    DYNAMIC_BACKGROUND_DIRECT_LOAD_TIMEOUT_MS: 900;
    DYNAMIC_BACKGROUND_DIRECT_RETRY_MS: 1500;
    DYNAMIC_BACKGROUND_NO_ART_CONFIRM_MS: 2500;
}
export function createArtworkController(dependencies: Dependencies) {
    const {
        state,
        applyPerformanceClassToPage,
        wakeAnimationLoop,
        artworkLoader,
        lifecycle,
        getLocalMediaElement,
        warn,
        ATMOSPHERE_ART_MAX_WIDTH,
        DYNAMIC_BACKGROUND_DOM_STABLE_MS,
        DYNAMIC_BACKGROUND_UNBOUND_DOM_CONFIRM_MS,
        DYNAMIC_BACKGROUND_INHERITED_DOM_STABLE_MS,
        DYNAMIC_BACKGROUND_INHERITED_DOM_CONFIRM_MS,
        ATMOSPHERE_IMAGE_TIMEOUT_MS,
        prefersReducedMotion,
        DYNAMIC_BACKGROUND_SETTINGS,
        DYNAMIC_BACKGROUND_WEBGL_RETRY_MAX_MS,
        DYNAMIC_BACKGROUND_WEBGL_RETRY_BASE_MS,
        DYNAMIC_BACKGROUND_SOURCE,
        DYNAMIC_BACKGROUND_ENGINE,
        DYNAMIC_BACKGROUND_TRANSITION_MS,
        DYNAMIC_BACKGROUND_WEAK_RECHECK_MS,
        DYNAMIC_BACKGROUND_NO_ART_RETRY_MS,
        DYNAMIC_BACKGROUND_DIRECT_GRACE_MS,
        DYNAMIC_BACKGROUND_DIRECT_LOAD_TIMEOUT_MS,
        DYNAMIC_BACKGROUND_DIRECT_RETRY_MS,
        DYNAMIC_BACKGROUND_NO_ART_CONFIRM_MS,
    } = dependencies;
    function readAtmosphereMode() {
        /* God Mode is intentionally single-engine. There is no atmosphere
         * preference state to migrate, persist, or accidentally revive. */
        return "dynamic";
    }

    function getAtmospherePage() {
        if (!isLyricsPage()) return null;
        return getCurrentLyricPage();
    }

    function removeAtmosphereRoot(source: string = "remove-root") {
        const root = state.atmosphereRoot;
        const parent = root && root.parentElement;
        disposeDynamicBackgroundRenderer(source);
        if (root) removeNode(root);
        if (parent && parent.classList) {
            parent.classList.remove("ak-atmosphere-host");
        }
        state.atmosphereRoot = null;
        document.documentElement.classList.remove("ak-atmosphere-dynamic-mode");
        document.documentElement.classList.remove("ak-lyricmotion-atmosphere-active");
    }

    function ensureAtmosphereRoot() {
        const page = getAtmospherePage();
        if (!page) {
            removeAtmosphereRoot("no-page");
            return null;
        }

        if (state.atmosphereRoot && state.atmosphereRoot.isConnected && state.atmosphereRoot.parentNode === page) {
            document.documentElement.classList.add("ak-lyricmotion-atmosphere-active");
            document.documentElement.classList.add("ak-atmosphere-dynamic-mode");
            startDynamicBackgroundRenderer();
            return state.atmosphereRoot;
        }

        if (state.atmosphereRoot && state.atmosphereRoot.isConnected && state.atmosphereRoot.parentNode !== page) {
            const staleParent = state.atmosphereRoot.parentElement;
            disposeDynamicBackgroundRenderer("stale-page-root");
            removeNode(state.atmosphereRoot);
            if (staleParent && staleParent.classList) {
                staleParent.classList.remove("ak-atmosphere-host");
            }
            state.atmosphereRoot = null;
        }

        const old = directChildByClass(page, "ak-atmosphere");
        if (old && state.atmosphereDynamicCanvas && old.contains && old.contains(state.atmosphereDynamicCanvas)) {
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
        state.atmosphereRoot = root;
        startDynamicBackgroundRenderer();
        return root;
    }

    function setAtmosphereMode(mode: string) {
        const normalized = String(mode || "dynamic")
            .trim()
            .toLowerCase();
        if (normalized !== "dynamic") {
            throw new Error('This God Mode build contains only the "dynamic" atmosphere.');
        }
        state.atmosphereMode = "dynamic";
        const root = ensureAtmosphereRoot();
        if (root) root.dataset.akMode = "dynamic";
        state.atmosphereLastCheck = 0;
        scheduleDynamicBackgroundProbeBurst("mode-confirmed");
        wakeAnimationLoop();
        return {
            mode: "dynamic",
            artwork: state.atmosphereArtwork,
            source: state.atmosphereSource,
        };
    }

    function normalizedMediaSource(media: HTMLMediaElement | null) {
        const raw = media ? media.currentSrc || media.src || "" : "";
        if (!raw) return "";
        try {
            const url = new URL(raw, location.href);
            const volatile = new Set([
                "api_key",
                "apikey",
                "access_token",
                "token",
                "playsessionid",
                "deviceid",
                "starttimeticks",
                "transcodingcontainer",
                "audiocodec",
                "videocodec",
                "maxstreamingbitrate",
                "userid",
            ]);
            for (const [key] of Array.from(url.searchParams.entries())) {
                if (volatile.has(String(key).toLowerCase())) {
                    url.searchParams.delete(key);
                }
            }
            /* Track identity is normally encoded in /Audio/<id> or /Videos/<id>.
             * Preserve the path and stable query parameters while removing only
             * transport/session noise. */
            const params = Array.from(url.searchParams.entries()).sort((a, b) => a[0].localeCompare(b[0]));
            url.search = "";
            for (const [key, value] of params) url.searchParams.append(key, value);
            return `${url.origin}${url.pathname}${url.search}`;
        } catch {
            /* Never retain malformed query strings in diagnostics/state because
             * they may contain API keys or session tokens. */
            return String(raw).split(/[?#]/, 1)[0];
        }
    }

    function atmosphereMediaKey(media: HTMLMediaElement | null) {
        return normalizedMediaSource(media);
    }

    function invalidateAtmosphereLoads(source: string = "invalidate") {
        state.atmosphereLoadSeq += 1;
        artworkLoader.invalidate();
        state.atmospherePendingKey = "";
        state.atmospherePendingSince = 0;
        return source;
    }

    function clearDynamicProbeTimers() {
        for (const timer of state.atmosphereDynamicProbeTimers || []) lifecycle.clearTimeout(timer);
        state.atmosphereDynamicProbeTimers = [];
    }

    function scheduleDynamicBackgroundProbeBurst(source: string = "probe") {
        const token = ++state.atmosphereDynamicProbeToken;
        clearDynamicProbeTimers();
        const delays = [0, 90, 220, 450, 800, 1250];
        state.atmosphereDynamicProbeTimers = delays.map((delay) =>
            lifecycle.timeout(() => {
                if (token !== state.atmosphereDynamicProbeToken || !isLyricsPage()) return;
                const media = getLocalMediaElement(true);
                if (!media) return;
                refreshAtmosphere(media, false).catch((error: unknown) => warn("Dynamic Background probe failed:", error));
            }, delay),
        );
        return source;
    }

    function mediaItemArtworkCandidate(media: HTMLMediaElement | null) {
        try {
            const src = media && (media.currentSrc || media.src);
            if (!src) return null;
            const mediaUrl = new URL(src, location.href);
            const match = mediaUrl.pathname.match(/\/(?:Audio|Videos)\/([^/?]+)/i);
            if (!match) return null;
            const itemId = decodeURIComponent(requireValue(match[1]));
            const prefix = mediaUrl.pathname.slice(0, match.index);
            const imageUrl = new URL(`${prefix}/Items/${encodeURIComponent(itemId)}/Images/Primary`, mediaUrl.origin);
            imageUrl.searchParams.set("maxWidth", String(ATMOSPHERE_ART_MAX_WIDTH));
            imageUrl.searchParams.set("quality", "88");
            const authKeys = new Set(["api_key", "apikey", "access_token", "token"]);
            for (const [key, value] of mediaUrl.searchParams.entries()) {
                if (value && authKeys.has(String(key).toLowerCase())) {
                    imageUrl.searchParams.set(key, value);
                }
            }
            return imageUrl.href;
        } catch {
            return null;
        }
    }

    function mediaItemId(media: HTMLMediaElement | null) {
        try {
            const src = media && (media.currentSrc || media.src);
            if (!src) return "";
            const url = new URL(src, location.href);
            const match = url.pathname.match(/\/(?:Audio|Videos)\/([^/?]+)/i);
            return match ? decodeURIComponent(requireValue(match[1])).toLowerCase() : "";
        } catch {
            return "";
        }
    }

    function currentLyricsItemId() {
        const key = String(state.lyricsAcceptedKey || state.lyricsRequestKey || "");
        const pathMatch = key.match(/\/(?:audio|videos|items)\/([^/?]+)\/lyrics(?:[/?]|$)/i);
        if (pathMatch) return decodeURIComponent(requireValue(pathMatch[1])).toLowerCase();
        const queryMatch = key.match(/[?&]itemid=([^&]+)/i);
        return queryMatch ? decodeURIComponent(requireValue(queryMatch[1])).toLowerCase() : "";
    }

    function artworkItemId(url: string) {
        try {
            const parsed = new URL(url, location.href);
            const match = parsed.pathname.match(/\/Items\/([^/?]+)\/Images\//i);
            return match ? decodeURIComponent(requireValue(match[1])).toLowerCase() : "";
        } catch {
            return "";
        }
    }

    function nodeBindsToItem(node: HTMLElement | null, itemId: string) {
        if (!node || !itemId) return false;
        let current: HTMLElement | null = node;
        for (let depth = 0; current && depth < 10; depth += 1) {
            const dataset = current.dataset || {};
            const candidates = [
                dataset.itemId,
                dataset.itemid,
                dataset.id,
                typeof current.getAttribute === "function" ? current.getAttribute("data-item-id") : null,
                typeof current.getAttribute === "function" ? current.getAttribute("data-itemid") : null,
                typeof current.getAttribute === "function" ? current.getAttribute("data-id") : null,
            ];
            if (candidates.some((value) => String(value || "").toLowerCase() === String(itemId).toLowerCase())) {
                return true;
            }
            current = current.parentElement;
        }
        return false;
    }

    function getBackgroundImageUrl(element: Element) {
        try {
            const value = getComputedStyle(element).backgroundImage;
            if (!value || value === "none") return null;
            const match = value.match(/url\(["']?(.*?)["']?\)/i);
            return match ? match[1] : null;
        } catch {
            return null;
        }
    }

    function domArtworkCandidates(media: HTMLMediaElement | null = null) {
        const candidates: ArtworkCandidate[] = [];
        const seen = new Set();
        const itemId = mediaItemId(media);
        const add = (url: string | null | undefined, score: number, node: HTMLElement | null = null) => {
            if (!url || seen.has(url) || !/\/Items\/|\/Images\//i.test(url)) return;
            seen.add(url);
            const urlItemId = artworkItemId(url);
            const nodeBound = !!(itemId && nodeBindsToItem(node, itemId));
            const playbackContext = !!(
                node &&
                typeof node.closest === "function" &&
                node.closest<HTMLElement>(".nowPlayingBar,.nowPlayingPage,.nowPlayingInfoContainer")
            );
            const boundToCurrentItem = !!(itemId && (urlItemId === itemId || nodeBound));

            /* Music commonly inherits Primary artwork from its Album item.
             * A URL item-id mismatch is therefore not enough to call the cover
             * stale when Jellyfin is presenting it inside the live now-playing
             * UI. Rapid-skip safety is still provided by the key-switch DOM
             * baseline and the unbound-candidate stability confirmation. */
            candidates.push({
                url,
                score,
                node,
                urlItemId,
                nodeBound,
                playbackContext,
                boundToCurrentItem,
                inheritedArtworkCandidate: !!(itemId && urlItemId && urlItemId !== itemId && (nodeBound || playbackContext)),
                conflictsCurrentItem: !!(itemId && urlItemId && urlItemId !== itemId && !nodeBound && !playbackContext),
            });
        };
        const selector = [
            ".nowPlayingBar img",
            ".nowPlayingPage img",
            ".nowPlayingInfoContainer img",
            ".detailImageContainer img",
            'img[src*="/Items/"]',
            'img[src*="/Images/"]',
        ].join(",");
        Array.from(document.querySelectorAll<HTMLImageElement>(selector)).forEach((image) => {
            const rect = image.getBoundingClientRect ? image.getBoundingClientRect() : { width: 1, height: 1 };
            const area = Math.max(1, rect.width * rect.height);
            const classText = String(image.className || "").toLowerCase();
            let score = Math.min(500000, area);
            if (classText.includes("nowplaying") || classText.includes("now-playing")) score += 1000000;
            const url = image.currentSrc || image.src || "";
            if (/\/Images\/Primary/i.test(url)) score += 300000;
            add(url, score, image);
        });
        const bgSelector = [
            ".nowPlayingBar [style]",
            ".nowPlayingPage [style]",
            ".nowPlayingInfoContainer [style]",
            ".detailImageContainer [style]",
        ].join(",");
        Array.from(document.querySelectorAll<HTMLElement>(bgSelector)).forEach((node: HTMLElement) => {
            const rect = node.getBoundingClientRect ? node.getBoundingClientRect() : { width: 1, height: 1 };
            add(getBackgroundImageUrl(node), 500000 + Math.min(500000, Math.max(1, rect.width * rect.height)), node);
        });
        return candidates.sort((a, b) => b.score - a.score);
    }

    function dynamicDomArtworkCandidateAllowed(candidate: ArtworkCandidate, baseline: Set<string> | null = null) {
        if (!candidate || !candidate.url || candidate.conflictsCurrentItem) {
            return false;
        }
        if (candidate.boundToCurrentItem) return true;
        return !(baseline && baseline.has(candidate.url));
    }

    function dynamicDomArtworkSignalsPresence(candidate: ArtworkCandidate) {
        return !!(
            candidate &&
            candidate.url &&
            !candidate.conflictsCurrentItem &&
            (candidate.boundToCurrentItem || candidate.playbackContext || candidate.inheritedArtworkCandidate)
        );
    }

    function dynamicDomArtworkTiming(candidate: ArtworkCandidate) {
        if (!candidate || !candidate.url) {
            return {
                mediaStableMs: DYNAMIC_BACKGROUND_DOM_STABLE_MS,
                confirmMs: DYNAMIC_BACKGROUND_UNBOUND_DOM_CONFIRM_MS,
                inheritedFastPath: false,
            };
        }
        if (candidate.boundToCurrentItem) {
            return {
                mediaStableMs: 0,
                confirmMs: 0,
                inheritedFastPath: false,
            };
        }
        if (candidate.inheritedArtworkCandidate && candidate.playbackContext && !candidate.conflictsCurrentItem) {
            return {
                mediaStableMs: DYNAMIC_BACKGROUND_INHERITED_DOM_STABLE_MS,
                confirmMs: DYNAMIC_BACKGROUND_INHERITED_DOM_CONFIRM_MS,
                inheritedFastPath: true,
            };
        }
        return {
            mediaStableMs: DYNAMIC_BACKGROUND_DOM_STABLE_MS,
            confirmMs: DYNAMIC_BACKGROUND_UNBOUND_DOM_CONFIRM_MS,
            inheritedFastPath: false,
        };
    }

    function loadedDomArtworkImage(candidate: ArtworkCandidate) {
        const node = candidate && candidate.node;
        if (!(node instanceof HTMLImageElement)) {
            return null;
        }
        const naturalWidth = Number(node.naturalWidth);
        const naturalHeight = Number(node.naturalHeight);
        if (node.complete === true && naturalWidth > 0 && naturalHeight > 0) {
            return node;
        }
        return null;
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
            state.atmosphereDynamicFingerprintFailures += 1;
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

    function preloadAtmosphereImage(url: string, timeoutMs: number = ATMOSPHERE_IMAGE_TIMEOUT_MS) {
        return artworkLoader.load(url, Math.max(1, Number(timeoutMs) || ATMOSPHERE_IMAGE_TIMEOUT_MS));
    }

    function updateAtmospherePlaybackState(media: HTMLMediaElement | null) {
        const renderer = state.atmosphereDynamicRenderer;
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
            renderScale: mobile ? 0.8 : 0.96,
            maxRenderLongEdge: mobile ? 1600 : 2560,
            onContextLost: () => {
                state.atmosphereDynamicContextLossCount += 1;
                state.atmosphereDynamicFallbackReason = "webgl-context-lost";
                const root = state.atmosphereRoot;
                if (root) {
                    /* A lost context cannot paint the canvas. Remove the ready
                     * flag as well as showing fallback; otherwise the later
                     * ready rule can still hide the fallback layers. */
                    root.classList.remove("ak-dynamic-webgl-ready");
                    root.classList.add("ak-dynamic-fallback-active");
                }
            },
            onContextRestored: () => {
                state.atmosphereDynamicFallbackReason = "webgl-context-restored-rebuild";
                rebuildDynamicBackgroundRenderer("context-restored");
            },
            onTransitionInterrupted: (count: number) => {
                state.atmosphereDynamicInterruptedTransitions = count;
            },
            onTransitionComplete: (count: number) => {
                state.atmosphereDynamicTransitionCount = count;
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
        state.atmosphereDynamicWebglAvailable = true;
        state.atmosphereDynamicWebglFailureCount = 0;
        state.atmosphereDynamicWebglRetryAt = 0;
        state.atmosphereDynamicFallbackReason = "";
        root.classList.add("ak-dynamic-webgl-ready");
        root.classList.remove("ak-dynamic-fallback-active");
        return true;
    }

    function recordDynamicBackgroundWebglFailure(root: HTMLElement | null, error: unknown, fallbackReason = "webgl-init-failed") {
        const now = performance.now();
        const canvas = (root && directChildByClass(root, "ak-atmosphere-dynamic-canvas")) || state.atmosphereDynamicCanvas;

        /* A failed upload can leave a renderer without a usable texture.
         * Dispose it so a due retry creates a clean context, but retain the
         * canvas identity so ensureDynamicBackgroundRenderer() honors backoff. */
        disposeDynamicBackgroundRenderer("webgl-failure");
        if (canvas instanceof HTMLCanvasElement) state.atmosphereDynamicCanvas = canvas;

        state.atmosphereDynamicWebglAvailable = false;
        state.atmosphereDynamicWebglFailureCount += 1;
        state.atmosphereDynamicWebglRetryAt =
            now +
            Math.min(
                DYNAMIC_BACKGROUND_WEBGL_RETRY_MAX_MS,
                DYNAMIC_BACKGROUND_WEBGL_RETRY_BASE_MS * Math.pow(2, Math.min(3, state.atmosphereDynamicWebglFailureCount - 1)),
            );
        state.atmosphereDynamicFallbackReason = String(error instanceof Error ? error.message : error || fallbackReason);

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
        failureReason = "webgl-image-upload-failed",
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
        } catch (error) {
            recordDynamicBackgroundWebglFailure(root, error, failureReason);
            return false;
        }
    }

    function ensureDynamicBackgroundRenderer() {
        const root = state.atmosphereRoot && state.atmosphereRoot.isConnected ? state.atmosphereRoot : ensureAtmosphereRoot();
        if (!root) return null;
        const canvas = directChildByClass(root, "ak-atmosphere-dynamic-canvas");
        if (!(canvas instanceof HTMLCanvasElement)) return null;
        if (state.atmosphereDynamicRenderer && state.atmosphereDynamicCanvas === canvas) {
            if (dynamicRendererHasCurrentTexture(state.atmosphereDynamicRenderer)) {
                markDynamicBackgroundWebglReady(root, state.atmosphereDynamicRenderer);
            } else {
                root.classList.remove("ak-dynamic-webgl-ready");
                root.classList.add("ak-dynamic-fallback-active");
            }
            return state.atmosphereDynamicRenderer;
        }

        const now = performance.now();
        const previousCanvas = state.atmosphereDynamicCanvas;
        if (previousCanvas && previousCanvas !== canvas) {
            state.atmosphereDynamicWebglFailureCount = 0;
            state.atmosphereDynamicWebglRetryAt = 0;
        } else if (previousCanvas === canvas && state.atmosphereDynamicWebglAvailable === false && now < state.atmosphereDynamicWebglRetryAt) {
            return null;
        }

        disposeDynamicBackgroundRenderer("renderer-recreate");
        state.atmosphereDynamicCanvas = canvas;
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
            state.atmosphereDynamicRenderer = renderer;
            state.atmosphereDynamicWebglAvailable = true;
            renderer.resizeToDisplaySize();
            state.atmosphereDynamicResizeCount += 1;
            return renderer;
        } catch (error) {
            return recordDynamicBackgroundWebglFailure(root, error, "webgl-init-failed");
        }
    }

    function startDynamicBackgroundRenderer() {
        if (document.hidden || prefersReducedMotion()) return false;
        const renderer = state.atmosphereDynamicRenderer || ensureDynamicBackgroundRenderer();
        if (!renderer) return false;
        renderer.start();
        return true;
    }

    function stopDynamicBackgroundRenderer(source: string = "stop") {
        if (state.atmosphereDynamicRenderer) state.atmosphereDynamicRenderer.stop();
        return source;
    }

    function disposeDynamicBackgroundRenderer(source: string = "dispose") {
        const renderer = state.atmosphereDynamicRenderer;
        state.atmosphereDynamicRenderer = null;
        if (renderer) {
            try {
                renderer.dispose();
            } catch {
                /* context can already be lost */
            }
        }
        state.atmosphereDynamicCanvas = null;
        return source;
    }

    function rebuildDynamicBackgroundRenderer(source: string = "rebuild") {
        const artwork = state.atmosphereDynamicCurrentArtwork;
        const fingerprint = state.atmosphereDynamicCurrentFingerprint;
        disposeDynamicBackgroundRenderer(source);
        if (!isLyricsPage()) return null;
        const renderer = ensureDynamicBackgroundRenderer();
        if (!renderer || !artwork) return renderer;
        const rebuildSeq = state.atmosphereLoadSeq;
        preloadAtmosphereImage(artwork)
            .then((image) => {
                if (!isLyricsPage() || rebuildSeq !== state.atmosphereLoadSeq || artwork !== state.atmosphereDynamicCurrentArtwork) return;
                const current = state.atmosphereDynamicRenderer;
                if (!current) return;
                if (loadDynamicBackgroundRendererImage(state.atmosphereRoot, current, image, "webgl-rebuild-image-upload-failed")) {
                    if (fingerprint) state.atmosphereDynamicCurrentFingerprint = fingerprint;
                }
            })
            .catch((error: unknown) => {
                if (!isLyricsPage() || rebuildSeq !== state.atmosphereLoadSeq || artwork !== state.atmosphereDynamicCurrentArtwork) {
                    return;
                }

                recordDynamicBackgroundWebglFailure(state.atmosphereRoot, error, "webgl-rebuild-image-load-failed");
            });
        return renderer;
    }

    function resizeDynamicBackgroundRenderer() {
        const renderer = state.atmosphereDynamicRenderer;
        if (!renderer) return false;
        try {
            const changed = renderer.resizeToDisplaySize();
            if (changed) {
                state.atmosphereDynamicResizeCount += 1;
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
        const root = state.atmosphereRoot;
        const active = dynamicFallbackLayer(root, state.atmosphereDynamicBaseIndex);
        if (active && artworkUrl) active.style.backgroundImage = `url(${JSON.stringify(artworkUrl)})`;
    }

    function setDynamicFallbackArtwork(artworkUrl: string) {
        const root = state.atmosphereRoot;
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
        const nextIndex = state.atmosphereDynamicBaseIndex === 0 ? 1 : 0;
        const next = dynamicFallbackLayer(root, nextIndex);
        const old = dynamicFallbackLayer(root, state.atmosphereDynamicBaseIndex);
        if (!next) return;
        next.style.backgroundImage = `url(${JSON.stringify(artworkUrl)})`;
        next.classList.remove("ak-dynamic-fallback-active-layer");
        void next.offsetWidth;
        next.classList.add("ak-dynamic-fallback-active-layer");
        if (old && old !== next) old.classList.remove("ak-dynamic-fallback-active-layer");
        state.atmosphereDynamicBaseIndex = nextIndex;
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

        const sameUrl = !!artworkUrl && artworkUrl === state.atmosphereDynamicCurrentArtwork;
        const comparable = !!artworkFingerprint && !!state.atmosphereDynamicCurrentFingerprint;
        const sameVisual = comparable && dynamicArtworkFingerprintsEquivalent(artworkFingerprint, state.atmosphereDynamicCurrentFingerprint);
        const sameArtwork = comparable ? sameVisual : sameUrl;
        state.atmosphereDynamicIdentityMethod = sameVisual
            ? sameUrl
                ? "url+visual-fingerprint"
                : "visual-fingerprint"
            : comparable
              ? "different-visual-fingerprint"
              : sameUrl
                ? "url-fallback"
                : "new-artwork";

        if (!artworkUrl || !image) {
            setDynamicFallbackArtwork("");
            state.atmosphereDynamicCurrentArtwork = "";
            state.atmosphereDynamicCurrentFingerprint = null;
            state.atmosphereArtwork = "";
            state.atmosphereSource = source || "no-artwork";
            const renderer = state.atmosphereDynamicRenderer;
            if (renderer) renderer.stop();
            root.classList.remove("ak-dynamic-webgl-ready");
            root.classList.add("ak-dynamic-fallback-active");
            root.classList.add("ak-atmosphere-ready");
            return true;
        }

        if (sameArtwork) {
            if (sameVisual && !sameUrl) state.atmosphereDynamicVisualDedupCount += 1;
            /* Same album, different track-specific URL: update only recovery URL
             * metadata. A healthy current texture is left entirely untouched;
             * an earlier WebGL failure is eligible to recover once its backoff
             * expires. */
            updateDynamicFallbackSameVisual(artworkUrl);
            state.atmosphereDynamicCurrentArtwork = artworkUrl;
            if (artworkFingerprint) state.atmosphereDynamicCurrentFingerprint = artworkFingerprint;
            state.atmosphereArtwork = artworkUrl;
            state.atmosphereSource = `${source || "unknown"}+same-visual-reuse`;
            root.classList.add("ak-atmosphere-ready");
            const existing = state.atmosphereDynamicRenderer;
            if (dynamicRendererHasCurrentTexture(existing)) {
                markDynamicBackgroundWebglReady(root, existing);
                if (!document.hidden && !prefersReducedMotion()) requireValue(existing).start();
                return false;
            }

            root.classList.remove("ak-dynamic-webgl-ready");
            root.classList.add("ak-dynamic-fallback-active");

            const retryAt = Number(state.atmosphereDynamicWebglRetryAt) || 0;
            if (retryAt && performance.now() < retryAt) return false;

            const retryRenderer = ensureDynamicBackgroundRenderer();
            if (retryRenderer) {
                loadDynamicBackgroundRendererImage(root, retryRenderer, image, "webgl-same-artwork-retry-failed");
            }

            return false;
        }

        setDynamicFallbackArtwork(artworkUrl);
        state.atmosphereDynamicCurrentArtwork = artworkUrl;
        state.atmosphereDynamicCurrentFingerprint = artworkFingerprint || null;
        const renderer = ensureDynamicBackgroundRenderer();
        if (renderer) {
            loadDynamicBackgroundRendererImage(root, renderer, image, "webgl-image-upload-failed");
        } else {
            root.classList.add("ak-dynamic-fallback-active");
        }

        state.atmosphereArtwork = artworkUrl;
        state.atmosphereSource = `${source || "unknown"}+dynamic-background`;
        state.atmosphereAnalysis = {
            extractionModel: "none-direct-artwork-webgl",
            paletteSource: "original-artwork-texture",
            referenceSource: DYNAMIC_BACKGROUND_SOURCE,
            engine: DYNAMIC_BACKGROUND_ENGINE,
            shader: "kawase-blur+simplex-domain-warp",
            blurSize: DYNAMIC_BACKGROUND_SETTINGS.blurSize,
            blurPasses: DYNAMIC_BACKGROUND_SETTINGS.blurPasses,
            warpIntensity: DYNAMIC_BACKGROUND_SETTINGS.warpIntensity,
            animationSpeed: DYNAMIC_BACKGROUND_SETTINGS.animationSpeed,
            saturation: DYNAMIC_BACKGROUND_SETTINGS.saturation,
            opacity: DYNAMIC_BACKGROUND_SETTINGS.opacity,
            audioResponsive: false,
            transitionDurationMs: DYNAMIC_BACKGROUND_TRANSITION_MS,
            transitionFix:
                "visible-dom-first+instant-inherited-art+direct-art-grace+latest-media-guard+per-url-stability+retrying-no-art+captured-interrupted-blend+visual-fingerprint-dedup",
            fallback: "dual-layer-css-direct-artwork",
        };
        root.classList.add("ak-atmosphere-ready");
        return true;
    }

    function dynamicRequestStillCurrent(sequence: number, key: string) {
        if (sequence !== state.atmosphereLoadSeq || state.lyricViewHidden || !isLyricsPage()) {
            state.atmosphereDynamicStaleCommitDrops += 1;
            return false;
        }
        const live = getLocalMediaElement(true);
        const liveKey = atmosphereMediaKey(live);
        const expectedItemId = currentLyricsItemId();
        const liveItemId = mediaItemId(live).toLowerCase();
        if (!live || !liveKey || liveKey !== key || (expectedItemId && liveItemId && liveItemId !== expectedItemId)) {
            state.atmosphereDynamicStaleCommitDrops += 1;
            return false;
        }
        return true;
    }

    async function refreshAtmosphere(media: HTMLMediaElement | null, force: boolean = false) {
        if (!media || state.lyricViewHidden || !isLyricsPage()) return;
        const key = atmosphereMediaKey(media);
        if (!key) return;
        const now = performance.now();
        if (key !== state.atmosphereMediaKey) {
            const previousKey = state.atmosphereMediaKey;
            state.atmosphereDynamicDomBaseline = previousKey ? new Set(domArtworkCandidates(media).map((candidate) => candidate.url)) : new Set();
            state.atmosphereMediaKey = key;
            state.atmosphereDynamicResolvedKey = "";
            state.atmosphereDynamicResolvedAt = 0;
            state.atmosphereDynamicNoArtwork = false;
            state.atmosphereDynamicNoArtFailures = 0;
            state.atmosphereDynamicDirectRetryAt = 0;
            state.atmosphereDynamicDomCandidateSinceByUrl.clear();
            state.atmosphereDynamicMediaStableSince = now;
            state.atmosphereDynamicWeakSource = false;
            state.atmosphereFailedKey = "";
            state.atmosphereFailedAt = 0;
        }

        if (!force && key === state.atmosphereDynamicResolvedKey) {
            const resolvedAge = now - state.atmosphereDynamicResolvedAt;
            const retryAt = Number(state.atmosphereDynamicWebglRetryAt) || 0;
            const webglRecoveryDue =
                (state.atmosphereDynamicWebglAvailable === false || !dynamicRendererHasCurrentTexture(state.atmosphereDynamicRenderer)) &&
                now >= retryAt;

            /* A stable direct-art result normally needs no more work. An
             * unchanged URL must still be re-entered once WebGL backoff expires
             * so a failed constructor/upload is not permanent for that album. */
            if (!state.atmosphereDynamicWeakSource && !state.atmosphereDynamicNoArtwork && !webglRecoveryDue) {
                return;
            }
            if (state.atmosphereDynamicWeakSource && resolvedAge < DYNAMIC_BACKGROUND_WEAK_RECHECK_MS && !webglRecoveryDue) {
                return;
            }
            if (state.atmosphereDynamicNoArtwork && resolvedAge < DYNAMIC_BACKGROUND_NO_ART_RETRY_MS && !webglRecoveryDue) {
                return;
            }
        }
        if (!force && key === state.atmospherePendingKey) return;
        if (!force && key === state.atmosphereFailedKey && now - state.atmosphereFailedAt < 800) return;

        state.atmospherePendingKey = key;
        state.atmospherePendingSince = now;
        const sequence = ++state.atmosphereLoadSeq;
        artworkLoader.invalidate();
        const finishPending = () => {
            if (sequence === state.atmosphereLoadSeq && state.atmospherePendingKey === key) {
                state.atmospherePendingKey = "";
                state.atmospherePendingSince = 0;
            }
        };

        try {
            /* The visible now-playing artwork is the primary source. This is
             * essential for music items that inherit Primary art from their
             * album: waiting for a synthetic track-level /Images/Primary
             * request to fail made those covers intrinsically slower. */
            /* DOM fallback must protect rapid skips without penalizing normal
             * album-inherited music art. Jellyfin often exposes several artwork
             * URLs at once, so stability is tracked per URL rather than through
             * one shared candidate timestamp. */
            if (!dynamicRequestStillCurrent(sequence, key)) return;

            const stableFor = performance.now() - state.atmosphereDynamicMediaStableSince;
            const baseline = state.atmosphereDynamicDomBaseline || new Set();
            const rawDomCandidates = domArtworkCandidates(media);
            const domCandidates = rawDomCandidates.filter((candidate) => dynamicDomArtworkCandidateAllowed(candidate, baseline));
            const visibleArtworkStillPresent = rawDomCandidates.some(dynamicDomArtworkSignalsPresence);
            const liveUrls = new Set(domCandidates.map((candidate) => candidate.url));
            for (const url of Array.from(state.atmosphereDynamicDomCandidateSinceByUrl.keys())) {
                if (!liveUrls.has(url)) {
                    state.atmosphereDynamicDomCandidateSinceByUrl.delete(url);
                }
            }

            let sawUnboundCandidate = false;
            for (const candidate of domCandidates) {
                const { url, boundToCurrentItem } = candidate;
                const timing = dynamicDomArtworkTiming(candidate);
                const candidateNow = performance.now();

                if (!boundToCurrentItem) {
                    sawUnboundCandidate = true;
                    if (!state.atmosphereDynamicDomCandidateSinceByUrl.has(url)) {
                        state.atmosphereDynamicDomCandidateSinceByUrl.set(url, candidateNow);
                    }
                }

                const candidateSince = boundToCurrentItem ? candidateNow : state.atmosphereDynamicDomCandidateSinceByUrl.get(url);
                const candidateStableFor = Math.max(0, candidateNow - requireValue(candidateSince));
                if (stableFor < timing.mediaStableMs) continue;
                if (!boundToCurrentItem && candidateStableFor < timing.confirmMs) continue;

                try {
                    const image = loadedDomArtworkImage(candidate) || (await preloadAtmosphereImage(url));
                    if (!dynamicRequestStillCurrent(sequence, key)) return;

                    const liveCandidate = domArtworkCandidates(media).find((item) => item.url === url);
                    if (!liveCandidate || liveCandidate.conflictsCurrentItem || !dynamicDomArtworkCandidateAllowed(liveCandidate, baseline)) {
                        continue;
                    }

                    const liveTiming = dynamicDomArtworkTiming(liveCandidate);
                    const liveNow = performance.now();
                    const liveStableFor = liveNow - state.atmosphereDynamicMediaStableSince;
                    const liveCandidateSince = liveCandidate.boundToCurrentItem ? liveNow : state.atmosphereDynamicDomCandidateSinceByUrl.get(url);
                    if (liveStableFor < liveTiming.mediaStableMs) continue;
                    if (
                        !liveCandidate.boundToCurrentItem &&
                        (!isFiniteNumber(liveCandidateSince) || liveNow - liveCandidateSince < liveTiming.confirmMs)
                    ) {
                        continue;
                    }

                    const fingerprint = dynamicArtworkFingerprint(image);
                    state.atmosphereDynamicWeakSource = true;
                    state.atmosphereDynamicNoArtwork = false;
                    state.atmosphereDynamicNoArtFailures = 0;
                    state.atmosphereDynamicResolvedKey = key;
                    state.atmosphereDynamicResolvedAt = performance.now();
                    state.atmosphereDynamicDomCandidateSinceByUrl.clear();
                    state.atmosphereDynamicDomFallbackCommits += 1;
                    if (liveTiming.inheritedFastPath) {
                        state.atmosphereDynamicFastInheritedCommits += 1;
                    }
                    activateDynamicBackgroundAtmosphere(
                        image,
                        url,
                        liveTiming.inheritedFastPath ? "jellyfin-dom-album-inherited-fast-fallback" : "jellyfin-dom-artwork-identity-gated-fallback",
                        fingerprint,
                    );
                    state.atmosphereFailedKey = "";
                    return;
                } catch {
                    // Continue to the next identity-safe DOM candidate.
                }
            }
            if (!sawUnboundCandidate) {
                state.atmosphereDynamicDomCandidateSinceByUrl.clear();
            }

            if (!dynamicRequestStillCurrent(sequence, key)) return;

            /* Give Jellyfin's own now-playing DOM a short window to paint the
             * new cover without holding atmospherePendingKey on a network
             * request. Probe-burst and artwork mutations can therefore commit
             * inherited album art on the first frame it becomes visible. */
            const directAge = performance.now() - state.atmosphereDynamicMediaStableSince;
            if (!force && directAge < DYNAMIC_BACKGROUND_DIRECT_GRACE_MS) {
                return;
            }

            const direct = mediaItemArtworkCandidate(media);
            if (direct && (force || performance.now() >= state.atmosphereDynamicDirectRetryAt)) {
                try {
                    const image = await preloadAtmosphereImage(direct, DYNAMIC_BACKGROUND_DIRECT_LOAD_TIMEOUT_MS);
                    if (!dynamicRequestStillCurrent(sequence, key)) return;
                    const fingerprint = dynamicArtworkFingerprint(image);
                    state.atmosphereDynamicWeakSource = false;
                    state.atmosphereDynamicNoArtwork = false;
                    state.atmosphereDynamicNoArtFailures = 0;
                    state.atmosphereDynamicDirectRetryAt = 0;
                    activateDynamicBackgroundAtmosphere(image, direct, "media-item-primary-fallback", fingerprint);
                    state.atmosphereDynamicResolvedKey = key;
                    state.atmosphereDynamicResolvedAt = performance.now();
                    state.atmosphereFailedKey = "";
                    return;
                } catch {
                    state.atmosphereDynamicDirectLoadFailures += 1;
                    state.atmosphereDynamicDirectRetryAt = performance.now() + DYNAMIC_BACKGROUND_DIRECT_RETRY_MS;
                }
            }

            if (!dynamicRequestStillCurrent(sequence, key)) return;
            const failureNow = performance.now();

            /* Never convert an identity-ambiguous but visibly present cover into
             * a confirmed no-art state. This is crucial for album-inherited
             * music artwork and same-album track changes. Keep the current
             * background in place, throttle the retry, and wait for Jellyfin's
             * DOM identity to settle instead of blanking the atmosphere. */
            if (visibleArtworkStillPresent) {
                state.atmosphereDynamicNoArtFailures = 0;
                state.atmosphereDynamicNoArtwork = false;
                state.atmosphereFailedKey = key;
                state.atmosphereFailedAt = failureNow;
                return;
            }

            state.atmosphereDynamicNoArtFailures += 1;
            state.atmosphereFailedKey = key;
            state.atmosphereFailedAt = failureNow;

            if (
                failureNow - state.atmosphereDynamicMediaStableSince >= DYNAMIC_BACKGROUND_NO_ART_CONFIRM_MS &&
                state.atmosphereDynamicNoArtFailures >= 2
            ) {
                activateDynamicBackgroundAtmosphere(null, "", "confirmed-no-artwork");
                state.atmosphereDynamicResolvedKey = key;
                state.atmosphereDynamicResolvedAt = failureNow;
                state.atmosphereDynamicWeakSource = false;
                state.atmosphereDynamicNoArtwork = true;
            }
        } finally {
            finishPending();
        }
    }

    function maybeRefreshAtmosphere(media: HTMLMediaElement | null, frameNow: number) {
        if (frameNow - state.atmosphereLastCheck < 250) return;
        state.atmosphereLastCheck = frameNow;
        const root = ensureAtmosphereRoot();
        if (root) root.dataset.akMode = "dynamic";
        refreshAtmosphere(media, false).catch((error: unknown) => warn("Dynamic Background refresh failed:", error));
    }

    return {
        readAtmosphereMode,
        getAtmospherePage,
        removeAtmosphereRoot,
        ensureAtmosphereRoot,
        setAtmosphereMode,
        normalizedMediaSource,
        atmosphereMediaKey,
        invalidateAtmosphereLoads,
        clearDynamicProbeTimers,
        scheduleDynamicBackgroundProbeBurst,
        mediaItemArtworkCandidate,
        mediaItemId,
        currentLyricsItemId,
        artworkItemId,
        nodeBindsToItem,
        getBackgroundImageUrl,
        domArtworkCandidates,
        dynamicDomArtworkCandidateAllowed,
        dynamicDomArtworkSignalsPresence,
        dynamicDomArtworkTiming,
        loadedDomArtworkImage,
        dynamicArtworkFingerprintFromPixels,
        dynamicArtworkFingerprint,
        dynamicArtworkFingerprintsEquivalent,
        preloadAtmosphereImage,
        updateAtmospherePlaybackState,
        dynamicBackgroundRendererOptions,
        dynamicRendererHasCurrentTexture,
        markDynamicBackgroundWebglReady,
        recordDynamicBackgroundWebglFailure,
        loadDynamicBackgroundRendererImage,
        ensureDynamicBackgroundRenderer,
        startDynamicBackgroundRenderer,
        stopDynamicBackgroundRenderer,
        disposeDynamicBackgroundRenderer,
        rebuildDynamicBackgroundRenderer,
        resizeDynamicBackgroundRenderer,
        dynamicFallbackLayer,
        updateDynamicFallbackSameVisual,
        setDynamicFallbackArtwork,
        activateDynamicBackgroundAtmosphere,
        dynamicRequestStillCurrent,
        refreshAtmosphere,
        maybeRefreshAtmosphere,
    };
}
