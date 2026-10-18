/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
export function setText<T extends Element>(element: T | null | undefined, text: string): T | null | undefined {
    if (element) element.textContent = text;
    return element;
}
export function replaceChildren(element: Element | null | undefined, ...nodes: (Node | string)[]): void {
    element?.replaceChildren(...nodes);
}
export function directChildByClass(element: Element | null | undefined, className: string): Element | null {
    return element ? (Array.from(element.children).find((child) => child.classList.contains(className)) ?? null) : null;
}
export function removeNode(element: Element | null | undefined): void {
    element?.remove();
}
