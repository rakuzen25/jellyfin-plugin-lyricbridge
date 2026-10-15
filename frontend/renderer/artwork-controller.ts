import {
    ATMOSPHERE_ART_MAX_WIDTH,
    ATMOSPHERE_IMAGE_TIMEOUT_MS,
    DYNAMIC_BACKGROUND_DIRECT_GRACE_MS,
    DYNAMIC_BACKGROUND_DIRECT_LOAD_TIMEOUT_MS,
    DYNAMIC_BACKGROUND_DIRECT_RETRY_MS,
    DYNAMIC_BACKGROUND_DOM_STABLE_MS,
    DYNAMIC_BACKGROUND_INHERITED_DOM_CONFIRM_MS,
    DYNAMIC_BACKGROUND_INHERITED_DOM_STABLE_MS,
    DYNAMIC_BACKGROUND_NO_ART_CONFIRM_MS,
    DYNAMIC_BACKGROUND_NO_ART_RETRY_MS,
    DYNAMIC_BACKGROUND_UNBOUND_DOM_CONFIRM_MS,
    DYNAMIC_BACKGROUND_WEAK_RECHECK_MS,
} from "./settings.ts";
/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
import { requireValue } from "../shared/invariants.ts";
import { Lifecycle } from "../shared/lifecycle.ts";
import type {} from "../shared/runtime.ts";
import { ArtworkLoader } from "./artwork-loader.ts";
import { isLyricsPage } from "./host.ts";
import type { ArtworkCandidate } from "./models.ts";
import type { RendererState } from "./state.ts";
function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

import { createArtworkSurface } from "./artwork-surface.ts";
interface OwnedState {
    atmosphereTimeoutCount: number;
    atmosphereLoadSeq: number;
    atmospherePendingKey: string;
    atmospherePendingSince: number;
    atmosphereDynamicProbeTimers: number[];
    atmosphereDynamicProbeToken: number;
    atmosphereDynamicStaleCommitDrops: number;
    atmosphereMediaKey: string;
    atmosphereDynamicDomBaseline: Set<string>;
    atmosphereDynamicResolvedKey: string;
    atmosphereDynamicResolvedAt: number;
    atmosphereDynamicNoArtwork: boolean;
    atmosphereDynamicNoArtFailures: number;
    atmosphereDynamicDirectRetryAt: number;
    atmosphereDynamicDomCandidateSinceByUrl: Map<string, number>;
    atmosphereDynamicMediaStableSince: number;
    atmosphereDynamicWeakSource: boolean;
    atmosphereFailedKey: string;
    atmosphereFailedAt: number;
    atmosphereDynamicDomFallbackCommits: number;
    atmosphereDynamicFastInheritedCommits: number;
    atmosphereDynamicDirectLoadFailures: number;
    atmosphereLastCheck: number;
}
interface Dependencies {
    state: Pick<RendererState, "lyricsAcceptedKey" | "lyricsRequestKey" | "lyricViewHidden" | "mediaElement" | "performanceProfile">;
    applyPerformanceClassToPage: (page: HTMLElement | null) => void;
    artworkLoader: ArtworkLoader<HTMLImageElement>;
    lifecycle: Lifecycle;
    getLocalMediaElement: (forceProbe?: boolean) => HTMLMediaElement | null;
    warn: (...args: unknown[]) => void;
    prefersReducedMotion: () => boolean;
}
export function createArtworkController(dependencies: Dependencies) {
    const { state, artworkLoader, lifecycle, getLocalMediaElement, warn } = dependencies;
    const owned: OwnedState = {
        atmosphereTimeoutCount: 0,
        atmosphereLoadSeq: 0,
        atmospherePendingKey: "",
        atmospherePendingSince: 0,
        atmosphereDynamicProbeTimers: [],
        atmosphereDynamicProbeToken: 0,
        atmosphereDynamicStaleCommitDrops: 0,
        atmosphereMediaKey: "",
        atmosphereDynamicDomBaseline: new Set(),
        atmosphereDynamicResolvedKey: "",
        atmosphereDynamicResolvedAt: 0,
        atmosphereDynamicNoArtwork: false,
        atmosphereDynamicNoArtFailures: 0,
        atmosphereDynamicDirectRetryAt: 0,
        atmosphereDynamicDomCandidateSinceByUrl: new Map(),
        atmosphereDynamicMediaStableSince: 0,
        atmosphereDynamicWeakSource: false,
        atmosphereFailedKey: "",
        atmosphereFailedAt: 0,
        atmosphereDynamicDomFallbackCommits: 0,
        atmosphereDynamicFastInheritedCommits: 0,
        atmosphereDynamicDirectLoadFailures: 0,
        atmosphereLastCheck: 0,
    };
    const surface = createArtworkSurface({ ...dependencies, preloadAtmosphereImage });
    const { ensureAtmosphereRoot, dynamicArtworkFingerprint, activateDynamicBackgroundAtmosphere } = surface;
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
        owned.atmosphereLoadSeq += 1;
        surface.invalidateLoads();
        artworkLoader.invalidate();
        owned.atmospherePendingKey = "";
        owned.atmospherePendingSince = 0;
        return source;
    }

    function clearDynamicProbeTimers() {
        for (const timer of owned.atmosphereDynamicProbeTimers || []) lifecycle.clearTimeout(timer);
        owned.atmosphereDynamicProbeTimers = [];
    }

    function scheduleDynamicBackgroundProbeBurst(source: string = "probe") {
        const token = ++owned.atmosphereDynamicProbeToken;
        clearDynamicProbeTimers();
        const delays = [0, 90, 220, 450, 800, 1250];
        owned.atmosphereDynamicProbeTimers = delays.map((delay) =>
            lifecycle.timeout(() => {
                if (token !== owned.atmosphereDynamicProbeToken || !isLyricsPage()) return;
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

    function preloadAtmosphereImage(url: string, timeoutMs: number = ATMOSPHERE_IMAGE_TIMEOUT_MS) {
        return artworkLoader.load(url, Math.max(1, Number(timeoutMs) || ATMOSPHERE_IMAGE_TIMEOUT_MS));
    }

    function dynamicRequestStillCurrent(sequence: number, key: string) {
        if (sequence !== owned.atmosphereLoadSeq || state.lyricViewHidden || !isLyricsPage()) {
            owned.atmosphereDynamicStaleCommitDrops += 1;
            return false;
        }
        const live = getLocalMediaElement(true);
        const liveKey = atmosphereMediaKey(live);
        const expectedItemId = currentLyricsItemId();
        const liveItemId = mediaItemId(live).toLowerCase();
        if (!live || !liveKey || liveKey !== key || (expectedItemId && liveItemId && liveItemId !== expectedItemId)) {
            owned.atmosphereDynamicStaleCommitDrops += 1;
            return false;
        }
        return true;
    }

    async function refreshAtmosphere(media: HTMLMediaElement | null, force: boolean = false) {
        if (!media || state.lyricViewHidden || !isLyricsPage()) return;
        const key = atmosphereMediaKey(media);
        if (!key) return;
        const now = performance.now();
        if (key !== owned.atmosphereMediaKey) {
            const previousKey = owned.atmosphereMediaKey;
            owned.atmosphereDynamicDomBaseline = previousKey ? new Set(domArtworkCandidates(media).map((candidate) => candidate.url)) : new Set();
            owned.atmosphereMediaKey = key;
            owned.atmosphereDynamicResolvedKey = "";
            owned.atmosphereDynamicResolvedAt = 0;
            owned.atmosphereDynamicNoArtwork = false;
            owned.atmosphereDynamicNoArtFailures = 0;
            owned.atmosphereDynamicDirectRetryAt = 0;
            owned.atmosphereDynamicDomCandidateSinceByUrl.clear();
            owned.atmosphereDynamicMediaStableSince = now;
            owned.atmosphereDynamicWeakSource = false;
            owned.atmosphereFailedKey = "";
            owned.atmosphereFailedAt = 0;
        }

        if (!force && key === owned.atmosphereDynamicResolvedKey) {
            const resolvedAge = now - owned.atmosphereDynamicResolvedAt;
            const retryAt = Number(surface.webglRetryAt) || 0;
            const webglRecoveryDue = surface.needsWebglRecovery && now >= retryAt;

            /* A stable direct-art result normally needs no more work. An
             * unchanged URL must still be re-entered once WebGL backoff expires
             * so a failed constructor/upload is not permanent for that album. */
            if (!owned.atmosphereDynamicWeakSource && !owned.atmosphereDynamicNoArtwork && !webglRecoveryDue) {
                return;
            }
            if (owned.atmosphereDynamicWeakSource && resolvedAge < DYNAMIC_BACKGROUND_WEAK_RECHECK_MS && !webglRecoveryDue) {
                return;
            }
            if (owned.atmosphereDynamicNoArtwork && resolvedAge < DYNAMIC_BACKGROUND_NO_ART_RETRY_MS && !webglRecoveryDue) {
                return;
            }
        }
        if (!force && key === owned.atmospherePendingKey) return;
        if (!force && key === owned.atmosphereFailedKey && now - owned.atmosphereFailedAt < 800) return;

        owned.atmospherePendingKey = key;
        owned.atmospherePendingSince = now;
        const sequence = ++owned.atmosphereLoadSeq;
        artworkLoader.invalidate();
        const finishPending = () => {
            if (sequence === owned.atmosphereLoadSeq && owned.atmospherePendingKey === key) {
                owned.atmospherePendingKey = "";
                owned.atmospherePendingSince = 0;
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

            const stableFor = performance.now() - owned.atmosphereDynamicMediaStableSince;
            const baseline = owned.atmosphereDynamicDomBaseline || new Set();
            const rawDomCandidates = domArtworkCandidates(media);
            const domCandidates = rawDomCandidates.filter((candidate) => dynamicDomArtworkCandidateAllowed(candidate, baseline));
            const visibleArtworkStillPresent = rawDomCandidates.some(dynamicDomArtworkSignalsPresence);
            const liveUrls = new Set(domCandidates.map((candidate) => candidate.url));
            for (const url of Array.from(owned.atmosphereDynamicDomCandidateSinceByUrl.keys())) {
                if (!liveUrls.has(url)) {
                    owned.atmosphereDynamicDomCandidateSinceByUrl.delete(url);
                }
            }

            let sawUnboundCandidate = false;
            for (const candidate of domCandidates) {
                const { url, boundToCurrentItem } = candidate;
                const timing = dynamicDomArtworkTiming(candidate);
                const candidateNow = performance.now();

                if (!boundToCurrentItem) {
                    sawUnboundCandidate = true;
                    if (!owned.atmosphereDynamicDomCandidateSinceByUrl.has(url)) {
                        owned.atmosphereDynamicDomCandidateSinceByUrl.set(url, candidateNow);
                    }
                }

                const candidateSince = boundToCurrentItem ? candidateNow : owned.atmosphereDynamicDomCandidateSinceByUrl.get(url);
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
                    const liveStableFor = liveNow - owned.atmosphereDynamicMediaStableSince;
                    const liveCandidateSince = liveCandidate.boundToCurrentItem ? liveNow : owned.atmosphereDynamicDomCandidateSinceByUrl.get(url);
                    if (liveStableFor < liveTiming.mediaStableMs) continue;
                    if (
                        !liveCandidate.boundToCurrentItem &&
                        (!isFiniteNumber(liveCandidateSince) || liveNow - liveCandidateSince < liveTiming.confirmMs)
                    ) {
                        continue;
                    }

                    const fingerprint = dynamicArtworkFingerprint(image);
                    owned.atmosphereDynamicWeakSource = true;
                    owned.atmosphereDynamicNoArtwork = false;
                    owned.atmosphereDynamicNoArtFailures = 0;
                    owned.atmosphereDynamicResolvedKey = key;
                    owned.atmosphereDynamicResolvedAt = performance.now();
                    owned.atmosphereDynamicDomCandidateSinceByUrl.clear();
                    owned.atmosphereDynamicDomFallbackCommits += 1;
                    if (liveTiming.inheritedFastPath) {
                        owned.atmosphereDynamicFastInheritedCommits += 1;
                    }
                    activateDynamicBackgroundAtmosphere(
                        image,
                        url,
                        liveTiming.inheritedFastPath ? "jellyfin-dom-album-inherited-fast-fallback" : "jellyfin-dom-artwork-identity-gated-fallback",
                        fingerprint,
                    );
                    owned.atmosphereFailedKey = "";
                    return;
                } catch {
                    // Continue to the next identity-safe DOM candidate.
                }
            }
            if (!sawUnboundCandidate) {
                owned.atmosphereDynamicDomCandidateSinceByUrl.clear();
            }

            if (!dynamicRequestStillCurrent(sequence, key)) return;

            /* Give Jellyfin's own now-playing DOM a short window to paint the
             * new cover without holding atmospherePendingKey on a network
             * request. Probe-burst and artwork mutations can therefore commit
             * inherited album art on the first frame it becomes visible. */
            const directAge = performance.now() - owned.atmosphereDynamicMediaStableSince;
            if (!force && directAge < DYNAMIC_BACKGROUND_DIRECT_GRACE_MS) {
                return;
            }

            const direct = mediaItemArtworkCandidate(media);
            if (direct && (force || performance.now() >= owned.atmosphereDynamicDirectRetryAt)) {
                try {
                    const image = await preloadAtmosphereImage(direct, DYNAMIC_BACKGROUND_DIRECT_LOAD_TIMEOUT_MS);
                    if (!dynamicRequestStillCurrent(sequence, key)) return;
                    const fingerprint = dynamicArtworkFingerprint(image);
                    owned.atmosphereDynamicWeakSource = false;
                    owned.atmosphereDynamicNoArtwork = false;
                    owned.atmosphereDynamicNoArtFailures = 0;
                    owned.atmosphereDynamicDirectRetryAt = 0;
                    activateDynamicBackgroundAtmosphere(image, direct, "media-item-primary-fallback", fingerprint);
                    owned.atmosphereDynamicResolvedKey = key;
                    owned.atmosphereDynamicResolvedAt = performance.now();
                    owned.atmosphereFailedKey = "";
                    return;
                } catch {
                    owned.atmosphereDynamicDirectLoadFailures += 1;
                    owned.atmosphereDynamicDirectRetryAt = performance.now() + DYNAMIC_BACKGROUND_DIRECT_RETRY_MS;
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
                owned.atmosphereDynamicNoArtFailures = 0;
                owned.atmosphereDynamicNoArtwork = false;
                owned.atmosphereFailedKey = key;
                owned.atmosphereFailedAt = failureNow;
                return;
            }

            owned.atmosphereDynamicNoArtFailures += 1;
            owned.atmosphereFailedKey = key;
            owned.atmosphereFailedAt = failureNow;

            if (
                failureNow - owned.atmosphereDynamicMediaStableSince >= DYNAMIC_BACKGROUND_NO_ART_CONFIRM_MS &&
                owned.atmosphereDynamicNoArtFailures >= 2
            ) {
                activateDynamicBackgroundAtmosphere(null, "", "confirmed-no-artwork");
                owned.atmosphereDynamicResolvedKey = key;
                owned.atmosphereDynamicResolvedAt = failureNow;
                owned.atmosphereDynamicWeakSource = false;
                owned.atmosphereDynamicNoArtwork = true;
            }
        } finally {
            finishPending();
        }
    }

    function maybeRefreshAtmosphere(media: HTMLMediaElement | null, frameNow: number) {
        if (frameNow - owned.atmosphereLastCheck < 250) return;
        owned.atmosphereLastCheck = frameNow;
        const root = ensureAtmosphereRoot();
        if (root) root.dataset.akMode = "dynamic";
        refreshAtmosphere(media, false).catch((error: unknown) => warn("Dynamic Background refresh failed:", error));
    }

    function requestRefresh() {
        owned.atmosphereLastCheck = 0;
    }
    function trackChanged() {
        owned.atmosphereFailedKey = "";
        requestRefresh();
    }
    function cancelProbes() {
        owned.atmosphereDynamicProbeToken++;
        clearDynamicProbeTimers();
    }
    lifecycle.own(cancelProbes);
    return {
        invalidateAtmosphereLoads,
        scheduleDynamicBackgroundProbeBurst,
        mediaItemId,
        currentLyricsItemId,
        refreshAtmosphere,
        maybeRefreshAtmosphere,
        removeAtmosphereRoot: surface.removeAtmosphereRoot,
        updateAtmospherePlaybackState: surface.updateAtmospherePlaybackState,
        startDynamicBackgroundRenderer: surface.startDynamicBackgroundRenderer,
        stopDynamicBackgroundRenderer: surface.stopDynamicBackgroundRenderer,
        rebuildDynamicBackgroundRenderer: surface.rebuildDynamicBackgroundRenderer,
        resizeDynamicBackgroundRenderer: surface.resizeDynamicBackgroundRenderer,
        requestRefresh,
        trackChanged,
        cancelProbes,
        resetMediaIdentity() {
            owned.atmosphereMediaKey = "";
        },
        recordTimeout() {
            owned.atmosphereTimeoutCount++;
        },
        get root() {
            return surface.root;
        },
        get artwork() {
            return surface.artwork;
        },
        diagnostics: () => ({ ...owned, ...surface.diagnostics() }),
    };
}
export type ArtworkDiagnostics = ReturnType<ReturnType<typeof createArtworkController>["diagnostics"]>;
