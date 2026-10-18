import type { BridgeDocument } from "../../contracts/bridge.ts";
import type { TrackScope } from "../session/contracts.ts";
import { button, e } from "../ui/controls.ts";
import { PreviewSession } from "./preview-session.ts";

export interface PlaybackPreviewRequest {
    document: BridgeDocument;
    description: string;
    returnLabel: string;
    panel: HTMLElement;
    trigger?: HTMLElement | null;
    onEnd?: () => void;
}
interface Dependencies {
    scope(): TrackScope | null;
    current(): BridgeDocument | null;
    time(): number;
    render(document: BridgeDocument): void;
    mount(bar: HTMLElement | null): void;
    pending(update: BridgeDocument, order?: number): void;
}
/** Owns the reversible playback transaction and its source panel, never saving lyrics. */
export class PlaybackPreview {
    readonly session = new PreviewSession<TrackScope, BridgeDocument>();
    private active: {
        request: PlaybackPreviewRequest;
        owner: TrackScope;
        scroll: { node: HTMLElement; top: number; left: number }[];
        trigger: HTMLElement | null;
        triggerLabel: string;
    } | null = null;
    private abort = () => this.end(false);
    constructor(private dependencies: Dependencies) {}
    get panel(): HTMLElement | null {
        return this.active?.request.panel ?? null;
    }
    get running(): boolean {
        return this.active != null;
    }
    start(request: PlaybackPreviewRequest): void {
        const owner = this.dependencies.scope(),
            current = this.dependencies.current();
        if (!owner || owner.controller.signal.aborted || !current || !request.panel.isConnected) return;
        const previous = this.active;
        if (previous) {
            previous.owner.controller.signal.removeEventListener("abort", this.abort);
            previous.request.onEnd?.();
            if (previous.owner === owner && previous.request.panel !== request.panel && previous.request.panel.isConnected)
                previous.request.panel.hidden = false;
        }
        this.session.begin(owner, current, this.dependencies.time());
        const trigger =
            request.trigger ??
            (document.activeElement instanceof HTMLElement && request.panel.contains(document.activeElement)
                ? document.activeElement
                : previous?.request.panel === request.panel
                  ? previous.trigger
                  : null);
        this.active = {
            request,
            owner,
            trigger,
            triggerLabel: trigger?.getAttribute("aria-label") || trigger?.textContent || "",
            scroll:
                previous?.request.panel === request.panel
                    ? previous.scroll
                    : [request.panel, ...request.panel.querySelectorAll<HTMLElement>("*")]
                          .filter(
                              (node) =>
                                  node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth || node.scrollTop || node.scrollLeft,
                          )
                          .map((node) => ({ node, top: node.scrollTop, left: node.scrollLeft })),
        };
        owner.controller.signal.addEventListener("abort", this.abort, { once: true });
        request.panel.hidden = true;
        this.dependencies.render(request.document);
        const bar = e("div", "lb-preview-playback-bar");
        bar.setAttribute("role", "region");
        bar.setAttribute("aria-label", "Lyric version playback preview");
        const back = button(request.returnLabel, () => this.end(), "", { icon: "back" });
        bar.append(e("span", "", request.description), back);
        this.dependencies.mount(bar);
        back.focus({ preventScroll: true });
    }
    end(restore = true): void {
        const active = this.active;
        this.active = null;
        this.dependencies.mount(null);
        const owner = this.dependencies.scope();
        const matches = !!active && owner === active.owner && !owner.controller.signal.aborted;
        const ending = this.session.finish(matches ? owner : null, restore);
        if (ending.baseline) this.dependencies.render(ending.baseline.doc);
        if (ending.pending) this.dependencies.pending(ending.pending.data, ending.pending.order);
        if (active) {
            active.owner.controller.signal.removeEventListener("abort", this.abort);
            active.request.onEnd?.();
            if (matches && restore && active.request.panel.isConnected) {
                active.request.panel.hidden = false;
                for (const item of active.scroll) {
                    item.node.scrollTop = item.top;
                    item.node.scrollLeft = item.left;
                }
                const trigger =
                    active.trigger?.isConnected && active.request.panel.contains(active.trigger)
                        ? active.trigger
                        : [...active.request.panel.querySelectorAll<HTMLButtonElement>("button")].find(
                              (node) => (node.getAttribute("aria-label") || node.textContent) === active.triggerLabel,
                          );
                trigger?.focus({ preventScroll: true });
            }
        }
    }
}
