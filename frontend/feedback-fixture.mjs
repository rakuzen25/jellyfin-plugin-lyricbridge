// Browser fixture bundles the same feedback primitives and adapters as production.
import { buildSync } from "esbuild";
export function feedbackFixture(directory) {
    return buildSync({
        stdin: {
            contents: `import { FeedbackScope } from './shared/feedback.ts';
import { glassFeedback } from './bridge/ui/feedback.ts';
import { materialFeedback } from './admin/ui/feedback.ts';
import { PlaybackNotifications } from './bridge/ui/playback-notifications.ts';
import { PlaybackPreview } from './bridge/preview/playback-preview.ts';
window.fixture = {FeedbackScope, glassFeedback, materialFeedback, PlaybackNotifications, PlaybackPreview};`,
            resolveDir: directory,
        },
        bundle: true,
        write: false,
        format: "iife",
    }).outputFiles[0].text;
}
