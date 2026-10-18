/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. Derived from the maintained LyricMotion fork. */
export function scrollGeometry(element: HTMLElement, elementHasLiveLayout: (element: Element) => boolean) {
    const viewport = window.visualViewport;
    const viewTop = viewport ? viewport.offsetTop : 0;
    const viewBottom = viewTop + (viewport ? viewport.height : window.innerHeight);
    let scroller: Element | null = element.parentElement;
    while (scroller && scroller !== document.body && scroller !== document.documentElement) {
        if (/auto|scroll/.test(getComputedStyle(scroller).overflowY)) break;
        scroller = scroller.parentElement;
    }
    const documentScroll = !scroller || scroller === document.body || scroller === document.documentElement;
    if (documentScroll) scroller = document.scrollingElement || document.documentElement;
    const rect = documentScroll ? { top: viewTop, bottom: viewBottom } : scroller!.getBoundingClientRect();
    let top = Math.max(viewTop, rect.top),
        bottom = Math.min(viewBottom, rect.bottom);
    for (const control of Array.from(document.querySelectorAll(".nowPlayingBar,.headerTop"))) {
        if (!elementHasLiveLayout(control)) continue;
        const bounds = control.getBoundingClientRect();
        if (control.matches(".nowPlayingBar") && bounds.top > top && bounds.top < bottom) bottom = bounds.top;
        else if (control.matches(".headerTop") && bounds.bottom > top && bounds.bottom < bottom) top = bounds.bottom;
    }
    return { scroller: scroller!, top, bottom, center: (top + bottom) / 2, scrollTop: rect.top, scrollBottom: rect.bottom };
}
