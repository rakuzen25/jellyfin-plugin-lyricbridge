const { expect } = require("playwright/test");
async function expectPlaybackPreview(page, returnLabel) {
    const bar = page.getByRole("region", { name: "Lyric version playback preview", exact: true });
    await expect(bar).toBeVisible();
    await expect(bar.getByRole("button")).toHaveCount(1);
    await expect(bar.getByRole("button", { name: returnLabel, exact: true })).toBeVisible();
    expect(
        await bar.evaluate((node) => {
            const root = node.closest(".lb-tools"),
                slot = node.parentElement;
            return (
                root.parentElement === document.body &&
                slot.classList.contains("lb-preview-slot") &&
                root.firstElementChild === slot &&
                getComputedStyle(root).position === "fixed"
            );
        }),
    ).toBe(true);
    const box = await bar.boundingBox(),
        viewport = page.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(
        await bar.getByRole("button").evaluate((node) => {
            const box = node.getBoundingClientRect();
            return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
        }),
    ).toBe(true);
}
module.exports = { expectPlaybackPreview };
