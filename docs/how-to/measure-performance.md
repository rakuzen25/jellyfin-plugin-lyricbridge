# Measure playback performance

Use repeatable synthetic playback to investigate regressions, then use real hardware for device-specific power or smoothness claims.
Start with [development setup](develop.md) and a built checkout.

## Run sustained acceptance

Run each performance project separately in the pinned offline image:

```sh
CI_BROWSER_GROUP=performance pnpm test browser --project stress-chromium --workers=1
CI_BROWSER_GROUP=performance pnpm test browser --project stress-mobile-chromium --workers=1
```

Keep other heavy builds and tests idle during measurement.
Inspect `long-session-performance.json` in the run's results for resource bounds, growth, and complete disposal.
A pass covers a bounded synthetic session; it does not establish hours of playback or behavior under real provider latency.
Thresholds and fixture durations belong to the [performance tests](../../tests/browser/performance/), not a separately maintained table here.

## Compare two builds

Preserve baseline assets before changing the renderer; never regenerate a baseline from the current build.
The [comparison tool](../../tests/browser/compare-playback-performance.cjs) accepts local asset directories and alternates baseline/current trials.
Use equivalent fixtures, viewports, device-pixel ratios, and browser/graphics implementations. Keep its raw output alongside the exact asset hashes.

Compare script/layout CPU, retained heap, and frame intervals separately.
Small trial counts support investigation rather than statistical performance claims.
Browser frame callbacks do not prove that every frame was painted, and JavaScript heap does not describe process or GPU memory.
The pinned headless browser uses software graphics; do not present its results as physical GPU measurements.

## Investigate a physical-device report

For heat, GPU memory, or visible stutter, reproduce on the affected device and browser.
Keep media, artwork, viewport, browser version, and background activity consistent between Standard and Low power runs.

1. Run each quality mode for the same sustained period.
2. Record tab/process memory, CPU, GPU activity, and visible smoothness at matching points.
3. Seek, change translations, and close/reopen the view in both runs.
4. Capture a short warmed-up performance trace around reproducible stutter.
5. Separate task/frame metrics from fan and temperature observations.

A headless pass cannot substitute for this evidence. Do not change thresholds or screenshot baselines merely to make a measurement pass.

## Next steps

[Run functional/rendering validation](validate.md) and [choose lower-load playback settings](playback.md#set-languages-and-display-preferences).
