/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
export const ROUTE_RE = /^#?!?\/?lyrics(?:[/?#]|$)/i;
export function detectStockJellyfinTvEnvironment(navigatorObject: Pick<Navigator, "userAgent" | "platform"> = navigator) {
    const ua = String((navigatorObject && navigatorObject.userAgent) || "").toLowerCase();

    const platform = String((navigatorObject && navigatorObject.platform) || "").toLowerCase();

    const haystack = `${ua} ${platform}`;
    const markers: [string, string[]][] = [
        ["lg-webos", ["web0s", "webos", "netcast"]],
        ["samsung-tizen", ["tizen", "samsung smart-tv", "samsung smarttv"]],
        ["hbbtv", ["hbbtv", "ce-html"]],
        ["hisense-vidaa", ["vidaa", "hisense tv", "hisense-tv"]],
        ["vizio", ["vizio", "viziotv"]],
        ["panasonic-viera", ["viera", "panasonic tv", "panasonic-tv"]],
        ["sony-bravia", ["bravia", "sony_tv", "sony tv"]],
        ["philips-tv", ["philips tv", "philips-tv"]],
        ["roku", ["roku", "rokutv"]],
        ["fire-tv", ["fire tv", "firetv"]],
        ["android-tv", ["android tv", "androidtv", "google tv", "googletv", "jellyfin android tv"]],
        ["apple-tv", ["appletv", "apple tv", "tvos"]],
        ["chromecast", ["crkey", "chromecast"]],
        ["opera-tv", ["opera tv", "opera-tv", "inettvbrowser"]],
        ["generic-smart-tv", ["smart tv", "tv browser", "tvbrowser", "dlnadoc"]],
        ["game-console-tv", ["playstation", "xbox"]],
    ];

    for (let index = 0; index < markers.length; index += 1) {
        const [family, tokens] = markers[index]!;

        for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
            if (haystack.indexOf(tokens[tokenIndex]!) >= 0) {
                return { detected: true, family };
            }
        }
    }

    /* Amazon Fire TV model identifiers are commonly AFT*. */
    if (/(^|[;\s(])aft[a-z0-9]+(?:[;\s)]|$)/i.test(haystack)) {
        return { detected: true, family: "fire-tv" };
    }

    /*
     * Some Android-TV WebViews omit the literal "Android TV" token but
     * identify a television device in the model section. Avoid broad
     * "Android + TV" heuristics that could accidentally disable phones.
     */
    if (/\b(shield android tv|mibox|mi box|nexus player)\b/i.test(haystack)) {
        return { detected: true, family: "android-tv" };
    }

    /*
     * Catch TV-labelled embedded browsers without stealing normal phones
     * or tablets. This intentionally runs after the named families so the
     * diagnostics retain the most useful platform label.
     */
    if (/\b(?:smart[- ]?tv|television|tv)\b/i.test(haystack) && !/\b(?:iphone|ipad|ipod|mobile)\b/i.test(haystack)) {
        return { detected: true, family: "generic-tv" };
    }

    /* Input-capability heuristics are intentionally not used as a TV
     * signal. Kiosks, desktop browser shells and accessibility setups can
     * legitimately report no touch and a coarse/no pointer. Only explicit
     * living-room platform signatures above may trigger stock-TV bypass. */

    return { detected: false, family: "" };
}

export function isLyricsUrl(url: unknown) {
    if (typeof url !== "string" || !url) return false;

    try {
        const parsed = new URL(url, location.href);
        const path = parsed.pathname || "";

        if (/\/(?:Audio|Items)\/[^/]+\/Lyrics(?:\/|$)/i.test(path)) {
            return true;
        }

        if (/\/Lyrics\/[^/]+(?:\/|$)/i.test(path)) {
            return true;
        }

        if (/\/Lyrics\/?$/i.test(path)) {
            return !!(parsed.searchParams.get("itemId") || parsed.searchParams.get("item_id"));
        }
    } catch {
        return (
            /\/(?:Audio|Items)\/[^/?#]+\/Lyrics(?:[/?#]|$)/i.test(url) ||
            /\/Lyrics\/[^/?#]+(?:[/?#]|$)/i.test(url) ||
            /\/Lyrics(?:\/?\?(?:[^#]*&)?(?:itemId|item_id)=)/i.test(url)
        );
    }

    return false;
}

export function elementHasLiveLayout(element: HTMLElement | null | undefined) {
    if (!element || element.isConnected === false || element.hidden) {
        return false;
    }

    try {
        if (typeof element.getClientRects === "function") {
            return element.getClientRects().length > 0;
        }
    } catch {
        // Detached/transitioning WebView nodes can throw during layout reads.
    }

    return true;
}

export function getCurrentLyricsContainer(enhancedOnly = false) {
    const selector = enhancedOnly ? ".lyricsContainer.ak-karaoke-container" : ".lyricsContainer";

    let candidates: HTMLElement[] = [];

    try {
        if (typeof document.querySelectorAll === "function") {
            candidates = Array.from(document.querySelectorAll<HTMLElement>(selector));
        }
    } catch {
        candidates = [];
    }

    if (!candidates.length) {
        try {
            const fallback = document.querySelector<HTMLElement>(selector);
            if (fallback) candidates.push(fallback);
        } catch {
            // No matching lyric DOM yet.
        }
    }

    const live = candidates.filter((element) => elementHasLiveLayout(element));

    if (live.length) {
        /* Jellyfin appends the entering SPA page after the outgoing one. */
        return live[live.length - 1] ?? null;
    }

    const connected = candidates.filter((element) => element && element.isConnected !== false);

    return connected.length ? (connected[connected.length - 1] ?? null) : null;
}

export function getCurrentLyricPage() {
    const container = getCurrentLyricsContainer(false);

    if (container) {
        const page = container.closest<HTMLElement>(".lyricPage");
        if (page) return page;
    }

    let pages: HTMLElement[] = [];
    try {
        pages = Array.from(document.querySelectorAll<HTMLElement>(".lyricPage"));
    } catch {
        // Older embedded DOM implementations may expose only querySelector.
    }

    const live = pages.filter((page) => elementHasLiveLayout(page));
    if (live.length) return live[live.length - 1] ?? null;

    return pages.length ? (pages[pages.length - 1] ?? null) : document.querySelector<HTMLElement>(".lyricPage");
}

export function isLyricsPage() {
    const hash = String(location.hash || "");

    if (hash) {
        return ROUTE_RE.test(hash);
    }

    const container = getCurrentLyricsContainer(false);

    return !!(container && elementHasLiveLayout(container));
}
