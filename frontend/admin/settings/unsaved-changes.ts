import { adminButton } from "../ui/controls.ts";

export function createDiscardDialog(page: HTMLElement) {
    let dismiss: (() => void) | undefined;
    return {
        open(message: string, actions: { label: string; run(): void }[]) {
            if (dismiss) return;
            const previous = document.activeElement;
            const dialog = document.createElement("dialog");
            dialog.className = "lb-settings-surface lb-unsaved-dialog";
            dialog.setAttribute("aria-label", "Unsaved changes");
            const text = document.createElement("p");
            text.textContent = message;
            text.id = "lb-unsaved-dialog-message";
            text.tabIndex = -1;
            text.setAttribute("autofocus", "");
            dialog.setAttribute("aria-describedby", text.id);
            const controls = document.createElement("div");
            controls.className = "lb-actions";
            const close = () => {
                dialog.close();
                dialog.remove();
                dismiss = undefined;
                if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
            };
            dismiss = close;
            controls.append(adminButton("Keep editing", close, "quiet"));
            for (const action of actions)
                controls.append(
                    adminButton(
                        action.label,
                        () => {
                            close();
                            action.run();
                        },
                        "quiet",
                    ),
                );
            dialog.append(text, controls);
            dialog.addEventListener("cancel", (event) => {
                event.preventDefault();
                close();
            });
            page.append(dialog);
            dialog.showModal();
            text.focus({ preventScroll: true });
        },
        dismiss() {
            dismiss?.();
        },
    };
}

export function createNavigationGuard(d: {
    unsaved(): boolean;
    saving(): boolean;
    discard(): void;
    blocked(): void;
    dialog: ReturnType<typeof createDiscardDialog>;
}) {
    let active = false,
        listening = false,
        replay: HTMLAnchorElement | undefined;
    const beforeUnload = (event: BeforeUnloadEvent) => {
        if (!active || (!d.unsaved() && !d.saving())) return;
        event.preventDefault();
        event.returnValue = "";
    };
    const click = (event: MouseEvent) => {
        if (!active || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
        if (!link) return;
        if (link === replay) {
            replay = undefined;
            return;
        }
        const target = link.getAttribute("target") || document.querySelector("base")?.target;
        if ((target && target !== "_self") || link.hasAttribute("download")) return;
        const destination = new URL(link.href, location.href);
        if (!["http:", "https:"].includes(destination.protocol) || destination.href === location.href) return;
        if (
            destination.origin === location.origin &&
            destination.pathname === location.pathname &&
            destination.search === location.search &&
            (link.getAttribute("href") === "#" || (destination.hash && document.getElementById(destination.hash.slice(1))))
        )
            return;
        if (!d.unsaved() && !d.saving()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (d.saving()) {
            d.blocked();
            return;
        }
        d.dialog.open("Discard unsaved settings and leave this page?", [
            {
                label: "Discard changes and leave",
                run: () => {
                    if (d.saving()) {
                        d.blocked();
                        return;
                    }
                    d.discard();
                    update();
                    replay = link;
                    try {
                        link.click();
                    } finally {
                        replay = undefined;
                    }
                },
            },
        ]);
    };
    function update() {
        const needed = active && (d.unsaved() || d.saving());
        if (needed === listening) return;
        listening = needed;
        if (needed) window.addEventListener("beforeunload", beforeUnload);
        else window.removeEventListener("beforeunload", beforeUnload);
    }
    return {
        update,
        active(value: boolean) {
            active = value;
            document.removeEventListener("click", click, true);
            if (value) document.addEventListener("click", click, true);
            else d.dialog.dismiss();
            update();
        },
    };
}
