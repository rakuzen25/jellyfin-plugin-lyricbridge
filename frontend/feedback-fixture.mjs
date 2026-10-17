// Browser fixture bundles the same feedback primitives and adapters as production.
import { buildSync } from "esbuild";
export function feedbackFixture(directory) {
    return buildSync({
        stdin: {
            contents: `import { FeedbackScope } from './shared/feedback.ts';
import { glassFeedback } from './bridge/feedback.ts';
import { materialFeedback } from './admin/feedback.ts';
import { PlaybackNotifications } from './bridge/playback-notifications.ts';
import { PlaybackPreview } from './bridge/playback-preview.ts';
window.fixture = {FeedbackScope, glassFeedback, materialFeedback, PlaybackNotifications, PlaybackPreview};`,
            resolveDir: directory,
        },
        bundle: true,
        write: false,
        format: "iife",
    }).outputFiles[0].text;
}
