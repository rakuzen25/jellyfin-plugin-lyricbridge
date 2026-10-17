import { FeedbackScope, type FeedbackOptions, type FeedbackSeverity } from "../shared/feedback.ts";
import { button, e } from "./controls.ts";
import { glassFeedback } from "./feedback.ts";

export const notificationPriority = (severity: FeedbackSeverity = "info"): number =>
    ({ error: 0, warning: 1, progress: 2, info: 3, success: 3 })[severity];
interface Box {
    left: number;
    top: number;
    right: number;
    bottom: number;
}
export function notificationBounds(host: Box, viewport: Box, reserved: readonly Box[] = [], gap = 12) {
    const left = Math.max(host.left, viewport.left) + gap;
    const right = Math.min(host.right, viewport.right) - gap;
    let top = Math.max(host.top, viewport.top) + gap;
    let bottom = Math.min(host.bottom, viewport.bottom) - gap;
    const width = Math.max(0, Math.min(520, right - left));
    for (const box of reserved) {
        if (box.right <= left || box.left >= left + width || box.bottom <= top || box.top >= bottom) continue;
        if (box.top <= top + 80) top = Math.max(top, box.bottom + gap);
        else bottom = Math.min(bottom, box.top - gap);
    }
    return { left, top, width, height: Math.max(0, bottom - top) };
}
/** The lyric content can move; only its scrollport defines overlay geometry. */
function playbackScrollport(host: HTMLElement, viewport: Box): Box {
    if (!host.classList.contains("lyricPage")) return host.getBoundingClientRect();
    const content = host.getBoundingClientRect();
    let x = 0,
        y = 0;
    let scrollport = viewport;
    for (let node: HTMLElement | null = host; node; node = node.parentElement) {
        if (node !== host) {
            x += node.scrollLeft;
            y += node.scrollTop;
        }
        if (node !== document.body && node !== document.documentElement && /auto|scroll/.test(getComputedStyle(node).overflowY)) {
            const rect = node.getBoundingClientRect();
            scrollport = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
            break;
        }
    }
    // Keep the lyric view's unscrolled origin and width, rather than granting the
    // overlay the whole viewport (which includes Jellyfin's navigation header).
    return {
        left: Math.max(scrollport.left, content.left + x),
        right: Math.min(scrollport.right, content.right + x),
        top: Math.max(scrollport.top, content.top + y),
        bottom: scrollport.bottom,
    };
}
/** A transformed lyric ancestor makes fixed controls move with its scroller.
 * Reserve their unscrolled footprint, so collision avoidance cannot drag the overlay. */
function reservedControlBounds(node: HTMLElement): Box {
    const rect = node.getBoundingClientRect();
    let fixed: HTMLElement | null = node;
    while (fixed && getComputedStyle(fixed).position !== "fixed") fixed = fixed.parentElement;
    if (!fixed) return rect;
    let containing = fixed.parentElement;
    while (containing) {
        const style = getComputedStyle(containing);
        if (
            style.transform !== "none" ||
            style.perspective !== "none" ||
            style.filter !== "none" ||
            (style.backdropFilter && style.backdropFilter !== "none") ||
            /layout|paint|strict|content/.test(style.contain) ||
            /transform|perspective|filter/.test(style.willChange)
        )
            break;
        containing = containing.parentElement;
    }
    let x = 0,
        y = 0;
    for (let parent = containing; parent; parent = parent.parentElement) {
        x += parent.scrollLeft;
        y += parent.scrollTop;
    }
    return { left: rect.left + x, right: rect.right + x, top: rect.top + y, bottom: rect.bottom + y };
}
interface Entry {
    root: HTMLElement;
    options: FeedbackOptions;
    order: number;
    timer?: ReturnType<typeof setTimeout>;
    expired: boolean;
}
/** One collection per visible lyrics view. Request ownership remains in the bridge. */
export class PlaybackNotifications {
    private scope = new FeedbackScope(glassFeedback);
    private entries = new Map<string, Entry>();
    private order = 0;
    private expanded = false;
    private disposed = false;
    private frame = 0;
    private host: HTMLElement;
    private observer: ResizeObserver;
    private visibility: MutationObserver;
    private preview = e("div", "lb-preview-slot");
    private list = e("div", "lb-notification-list");
    private summary: HTMLButtonElement;
    constructor(privateRoot: HTMLElement, host: HTMLElement) {
        this.root = privateRoot;
        this.host = host;
        this.summary = button(
            "More notifications",
            () => {
                this.expanded = !this.expanded;
                this.render();
            },
            "lb-notification-summary",
        );
        this.summary.hidden = true;
        this.summary.setAttribute("aria-expanded", "false");
        this.list.id = "lb-notification-list";
        this.list.setAttribute("aria-label", "Playback notifications");
        this.summary.setAttribute("aria-controls", this.list.id);
        this.preview.hidden = true;
        this.root.replaceChildren(this.preview, this.list, this.summary);
        this.observer = new ResizeObserver(this.scheduleBounds);
        this.visibility = new MutationObserver(this.scheduleBounds);
        this.setHost(host);
        this.observer.observe(this.root);
        window.addEventListener("resize", this.scheduleBounds);
        window.addEventListener("scroll", this.scheduleBounds, true);
        window.visualViewport?.addEventListener("resize", this.scheduleBounds);
        window.visualViewport?.addEventListener("scroll", this.scheduleBounds);
        document.fonts?.addEventListener("loadingdone", this.scheduleBounds);
        this.root.addEventListener("focusin", this.focusIn);
        this.root.addEventListener("focusout", this.focusOut);
        this.root.addEventListener("toggle", this.scheduleBounds, true);
    }
    private root: HTMLElement;
    setHost(host: HTMLElement): void {
        this.observer?.unobserve(this.host);
        this.visibility?.disconnect();
        this.host = host;
        this.observer.observe(host);
        for (let node: HTMLElement | null = host; node; node = node.parentElement)
            this.visibility.observe(node, { attributes: true, attributeFilter: ["class", "hidden", "style"] });
        this.scheduleBounds();
    }
    setPreview(bar: HTMLElement | null): void {
        if (this.disposed) return;
        this.preview.replaceChildren(...(bar ? [bar] : []));
        this.preview.hidden = !bar;
        this.refreshBounds();
    }
    set(id: string, options: FeedbackOptions, classes = ""): HTMLElement {
        let entry = this.entries.get(id);
        if (!entry) {
            const root = e("div", "lb-notification-card lb-feedback " + classes);
            root.dataset.operation = id;
            entry = { root, options, order: this.order++, expired: false };
            this.entries.set(id, entry);
            this.list.append(root);
            this.observer.observe(root);
        }
        clearTimeout(entry.timer);
        entry.options = options;
        entry.expired = false;
        const focused = entry.root.contains(document.activeElement) ? document.activeElement : null;
        const label = focused?.textContent || "";
        this.scope.update(entry.root, { ...options, ttl: 0 });
        if (focused && document.activeElement !== focused && !entry.root.contains(document.activeElement)) {
            const replacement =
                [...entry.root.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === label) ||
                entry.root.querySelector<HTMLButtonElement>("button");
            replacement?.focus({ preventScroll: true });
        }
        const ttl = options.ttl ?? (options.severity === "success" ? 4000 : 0);
        if (ttl && options.message)
            entry.timer = setTimeout(() => {
                if (entry.root.contains(document.activeElement)) entry.expired = true;
                else {
                    this.remove(id);
                    options.expire?.();
                }
            }, ttl);
        this.render();
        return entry.root;
    }
    get(id: string): HTMLElement | undefined {
        return this.entries.get(id)?.root;
    }
    remove(id: string): void {
        const entry = this.entries.get(id);
        if (!entry) return;
        const focused = entry.root.contains(document.activeElement);
        clearTimeout(entry.timer);
        this.observer.unobserve(entry.root);
        this.scope.releaseWithin(entry.root);
        entry.root.remove();
        this.entries.delete(id);
        this.render();
        if (focused) {
            const next =
                this.list.querySelector<HTMLButtonElement>(".lb-notification-card:not([hidden]) button") ||
                (!this.summary.hidden ? this.summary : document.querySelector<HTMLButtonElement>(".lb-settings-trigger"));
            next?.focus({ preventScroll: true });
        }
    }
    private render(): void {
        if (this.disposed) return;
        const scroll = this.list.scrollTop;
        const sorted = [...this.entries.values()]
            .filter((entry) => !!entry.options.message)
            .sort((a, b) => notificationPriority(a.options.severity) - notificationPriority(b.options.severity) || a.order - b.order);
        const focused = sorted.find((entry) => entry.root.contains(document.activeElement));
        // Moving a focused node or hiding it can discard focus in some engines.
        if (!focused)
            for (let index = 0; index < sorted.length; index++) {
                const entry = sorted[index];
                if (entry && this.list.children[index] !== entry.root) this.list.insertBefore(entry.root, this.list.children[index] || null);
            }
        const visible = new Set(this.expanded ? sorted : sorted.slice(0, 2));
        if (focused && !visible.has(focused)) {
            const other = [...visible].at(-1);
            if (other) visible.delete(other);
            visible.add(focused);
        }
        for (const entry of this.entries.values()) entry.root.hidden = !visible.has(entry);
        this.summary.hidden = sorted.length <= 2;
        this.summary.setAttribute("aria-expanded", String(this.expanded));
        const caption = this.expanded ? "Show fewer" : Math.max(0, sorted.length - 2) + " more notifications";
        const label = this.summary.querySelector(".lb-action-label")!;
        if (label.textContent !== caption) label.textContent = caption;
        this.list.scrollTop = scroll;
        this.scheduleBounds();
    }
    private focusIn = (event: FocusEvent): void => {
        const target = event.target;
        if (!(target instanceof HTMLElement) || !this.list.contains(target)) return;
        const rect = target.getBoundingClientRect(),
            list = this.list.getBoundingClientRect();
        if (rect.bottom > list.bottom) this.list.scrollTop += rect.bottom - list.bottom;
        else if (rect.top < list.top) this.list.scrollTop -= list.top - rect.top;
    };
    private focusOut = (): void => {
        queueMicrotask(() => {
            if (this.disposed) return;
            for (const [id, entry] of this.entries)
                if (entry.expired && !entry.root.contains(document.activeElement)) {
                    this.remove(id);
                    entry.options.expire?.();
                }
            this.render();
        });
    };
    private scheduleBounds = (): void => {
        if (this.disposed || this.frame) return;
        this.frame = requestAnimationFrame(() => {
            this.frame = 0;
            this.bounds();
        });
    };
    refreshBounds(): void {
        if (!this.disposed) this.bounds();
    }
    private bounds(): void {
        const viewport = window.visualViewport;
        const top = viewport?.offsetTop || 0,
            left = viewport?.offsetLeft || 0;
        const safe = getComputedStyle(this.root);
        const safeTop = parseFloat(safe.getPropertyValue("--lb-notification-safe-top")) || 0;
        const safeLeft = parseFloat(safe.getPropertyValue("--lb-notification-safe-left")) || 0;
        const safeRight = parseFloat(safe.getPropertyValue("--lb-notification-safe-right")) || 0;
        const safeBottom = parseFloat(safe.getPropertyValue("--lb-notification-safe-bottom")) || 0;
        const reserved = [
            ...document.querySelectorAll<HTMLElement>(".headerTop,.skinHeader,.nowPlayingBar,.ak-lyrics-tools-bar,.lb-settings-trigger"),
        ]
            .filter((node) => node.getClientRects().length && !node.closest("[hidden],.hide"))
            .map(reservedControlBounds);
        const viewportBox = {
            left: left + safeLeft,
            top: top + safeTop,
            right: left + (viewport?.width || innerWidth) - safeRight,
            bottom: top + (viewport?.height || innerHeight) - safeBottom,
        };
        const box = notificationBounds(playbackScrollport(this.host, viewportBox), viewportBox, reserved);
        this.root.hidden =
            !this.host.isConnected ||
            !!this.host.closest("[hidden],.hide") ||
            !this.host.getClientRects().length ||
            !box.width ||
            !box.height ||
            (![...this.entries.values()].some((entry) => !!entry.options.message) && this.preview.hidden);
        for (const [property, value] of Object.entries({ left: box.left, top: box.top, maxWidth: box.width, maxHeight: box.height }))
            if (this.root.style[property as "left" | "top" | "maxWidth" | "maxHeight"] !== value + "px")
                this.root.style[property as "left" | "top" | "maxWidth" | "maxHeight"] = value + "px";
        this.root.style.setProperty("--lb-notification-height", box.height + "px");
    }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        cancelAnimationFrame(this.frame);
        this.observer.disconnect();
        this.visibility.disconnect();
        window.removeEventListener("resize", this.scheduleBounds);
        window.removeEventListener("scroll", this.scheduleBounds, true);
        window.visualViewport?.removeEventListener("resize", this.scheduleBounds);
        window.visualViewport?.removeEventListener("scroll", this.scheduleBounds);
        document.fonts?.removeEventListener("loadingdone", this.scheduleBounds);
        this.root.removeEventListener("focusin", this.focusIn);
        this.root.removeEventListener("focusout", this.focusOut);
        this.root.removeEventListener("toggle", this.scheduleBounds, true);
        for (const entry of this.entries.values()) clearTimeout(entry.timer);
        this.scope.dispose();
        this.entries.clear();
        this.root.replaceChildren();
    }
}
