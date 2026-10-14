import { test } from "node:test";
import assert from "node:assert/strict";
import { notificationBounds, notificationPriority } from "./playback-notifications.ts";
import type { FeedbackSeverity } from "../shared/feedback.ts";

test("notification priority puts actionable failures before progress and quiet feedback", () => {
    const levels: FeedbackSeverity[] = ["success", "info", "progress", "warning", "error"];
    assert.deepEqual(
        levels.sort((a, b) => notificationPriority(a) - notificationPriority(b)),
        ["error", "warning", "progress", "success", "info"],
    );
});
test("notification bounds intersect a smaller host with the visual viewport and controls", () => {
    const bounds = notificationBounds({ left: 50, top: 40, right: 450, bottom: 600 }, { left: 0, top: 0, right: 390, bottom: 500 }, [
        { left: 0, top: 0, right: 390, bottom: 80 },
        { left: 0, top: 450, right: 390, bottom: 500 },
    ]);
    assert.deepEqual(bounds, { left: 62, top: 92, width: 316, height: 346 });
    assert.equal(notificationBounds({ left: 0, top: 600, right: 200, bottom: 800 }, { left: 0, top: 0, right: 390, bottom: 500 }).height, 0);
});
