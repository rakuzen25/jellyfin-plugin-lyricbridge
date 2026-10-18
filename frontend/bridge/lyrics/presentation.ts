import type {} from "../../platform/globals.ts";
import type { LyricLine, RichLyrics } from "../../contracts/lyrics.ts";
import type { AuxiliaryKind, Preferences } from "../../contracts/preferences.ts";
import type {} from "../../platform/globals.ts";
import type { Lifecycle } from "../../shared/lifecycle.ts";
import { nativePayload } from "../../shared/lyrics.ts";
import type { TrackSessionPort } from "../session/ports.ts";
import { rendererPort } from "../transport/renderer-port.ts";
import { e } from "../ui/controls.ts";
import { auxiliary as auxiliaryText } from "./auxiliary.ts";
import { createLyricDecoration } from "./lyric-view.ts";

interface Dependencies {
    defaults: Preferences;
    trackSession: TrackSessionPort;
    metrics: { decorations: number; requests: number; stale: number; searchRowUpdates: number; searchSorts: number; maxSearchPaintMs: number };
    ensureTools: () => void;
    searchUsageRefresh: (() => void) | null;
    lifetime: Lifecycle;
    media: () => HTMLAudioElement | null;
    mountTimingBar: (bar: HTMLElement | null) => void;
}

/** Owns lyric presentation behavior and its installation lifetime. */
export function createLyricPresentation(deps: Dependencies) {
    let refreshFrame = 0;

    const lyricContainer = () =>
        [...document.querySelectorAll<HTMLElement>(".lyricsContainer")].filter((n) => n.getClientRects().length && !n.closest(".hide")).at(-1);

    let lyricViewHidden = false;

    const isLyrics = () => !lyricViewHidden && (location.hash.includes("lyrics") || location.pathname.endsWith("demo.html"));

    const lyricView = createLyricDecoration({
        defaults: deps.defaults,
        current: () => deps.trackSession.current,
        decorated: () => deps.metrics.decorations++,
        ensureTools: deps.ensureTools,
    });

    const decorate = lyricView.decorate;

    const auxiliary = (line: LyricLine, kind: AuxiliaryKind, preferences: Preferences, document = deps.trackSession.current) =>
        auxiliaryText(line, kind, preferences, document);

    function refreshRows() {
        deps.searchUsageRefresh?.();
        if (refreshFrame) return;
        refreshFrame = deps.lifetime.frame(() => {
            refreshFrame = 0;
            if (decorate([...(lyricContainer()?.querySelectorAll<HTMLElement>(".lyricsLine") || [])], lyricView.rows))
                rendererPort()?.refreshLayout?.(true);
        });
    }

    function render(doc: RichLyrics | null | undefined) {
        rendererPort()?.setSharedTimingOffset?.(deps.trackSession.current?.timingCorrection?.seconds || 0);
        const payload = nativePayload(doc);
        rendererPort()?.applyRichPayload?.(payload, deps.trackSession.scope?.itemId);
        const container = lyricContainer();
        if (!container) return;
        container.replaceChildren(
            ...payload.Lyrics.map((line, i) => {
                const node = e("div", "lyricsLine dynamicLyric", line.Text);
                node.id = "lyricPosition" + i;
                node.dataset.lyrictime = String(line.Start ?? "");
                node.onclick = () => {
                    if (deps.media() && line.Start != null) deps.media()!.currentTime = line.Start / 10000000;
                };
                return node;
            }),
        );
        deps.ensureTools();
        if (!doc) deps.mountTimingBar(null);
        refreshRows();
    }
    return {
        lyricContainer,
        isLyrics,
        lyricView,
        decorate,
        auxiliary,
        refreshRows,
        render,
        get refreshFrame(): number {
            return refreshFrame;
        },
        replaceRefreshFrame(value: number) {
            refreshFrame = value;
        },
        get lyricViewHidden(): boolean {
            return lyricViewHidden;
        },
        replaceLyricViewHidden(value: boolean) {
            lyricViewHidden = value;
        },
    };
}
