# Playback performance validation

The maintained comparison uses `tests/browser/compare-playback-performance.cjs`,
synthetic seekable audio, and a pinned official Playwright image with external
networking disabled. It alternates three trials of the a supplied baseline asset directory
and the current build for each viewport. Each short trial measures three seconds of multilingual playback after fonts, lyric rows and uploaded artwork are ready. The current tool uses DPR 2 and compares the supplied baseline, current Standard mode and current Low power mode. Graphics renderer, style/task time, retained heap and frame intervals are recorded.

Report median script/layout CPU, retained heap, delivered frame intervals and the
graphics renderer for equivalent inputs. Chromium CDP frame delivery does not guarantee
that every lyric or WebGL frame was painted. Headless measurements do not establish
physical-device power, GPU memory or thermal behavior.

The comparison fails when either CPU metric exceeds both 150% of its baseline
and baseline plus 50 ms. This is a coarse regression guard, not a performance
improvement claim. It accepts local asset directories only; it cannot target a
running Jellyfin installation or call lyric providers.

The pre-extraction asset hashes are recorded in
`tests/browser/visual-baseline-provenance.json`. The same assets supplied the
committed desktop/mobile Chromium, Firefox and WebKit screenshot baselines.
Normal browser acceptance uses `scripts/checks/test-browser.sh`; intentional screenshot
updates require visual review. 

## Sustained playback and ownership

`long-session.spec.cjs` exercises five minutes of actual playback per Chromium viewport, sixty track/artwork changes, and sixty view hide/show transitions with a running synthetic generation job. Background frames must advance before sampling.
It records script/layout CPU and separate cleanup, animation-frame, timeout and
interval counts. Long-lived registrations must stay constant; hidden views have
no active frames or artwork loads; complete disposal must return every owned
resource count to zero. The first and last measured groups also have a coarse
CPU-growth guard. Reports are attached as `long-session-performance.json`.

The local before/after comparison also accepts `--long` after its two asset
paths. This runs the same sixty-second, twelve-transition fixture against both
revisions in desktop and mobile Chromium, with one alternating trial per
revision. It records resource counts and uses the existing CPU-regression guard.
This longer comparison is exploratory evidence with one sample per configuration,
not a statistical benchmark. Preserve the baseline directory; do not regenerate
it from current assets.

These checks cover a bounded synthetic session, not hours of playback, physical
phones, thermal throttling or real provider/network latency. Current results and artifact hashes belong in `dist/validation.json`.

## Rendering quality and refresh behavior

Standard is the default. It retains 60-fps lyric updates and a 30-fps artwork background, with separate 800/480-pixel desktop/mobile warp limits and existing output limits. WebGL uses the browser's default power preference. Glyph transforms preserve the reviewed visual baseline; identical transform writes are cached.

Choose **Lyrics settings → Display → Text sizes and layout → Rendering quality → Low power** to freeze artwork and disable glyph lift/glow while retaining 30-fps timed sweeps. This choice is local to the browser, independent of server/account display preferences and desktop/mobile profiling. `window.JellyfinLyricMotion.setRenderQuality("standard" | "low-power")` and `renderQuality()` expose the same typed option. Reduced motion remains respected.

Identical original timelines retain their nodes and playback/follow state. Auxiliary refreshes update bridge-owned rows and preserve scroll position. Original text, IDs or cue changes still invalidate the timeline. Geometry work is deferred from line-transition writes; cached scroll-space measurements are invalidated by geometry, viewport and relevant boundary-height changes. Paused rendering already settles and then stops; seek/timing/layout events wake it explicitly. Media wake listeners are detached when the active audio/video element changes, preventing removed player nodes from accumulating runtime-owned registrations. A separate regression replaces the element repeatedly; track-source-only stress cannot establish this invariant.

Do not equate JavaScript heap, layer pixel estimates or headless FPS with Chrome's process/GPU memory or physical power use. The pinned Linux browser uses SwiftShader software rendering. Report its results separately from real graphics hardware. Windows heat, GPU memory and ten-minute Standard/Low-power verification require a physical browser run; no automated result substitutes for it.

## Physical Windows verification

Use identical browser version, viewport, DPR, media and artwork for ten minutes in Standard and then Low power. Close unrelated GPU-heavy tabs and keep other conditions unchanged. At startup and minutes 2, 5 and 10, record Chrome Task Manager tab/GPU process memory and CPU, Windows GPU utilization, visible frame smoothness and fan behavior. In each run, seek repeatedly, switch translations, start a mocked generation fixture, and close/reopen the lyrics view. Capture a short warmed-up Performance trace around any reproducible jerk rather than recording an unbounded ten-minute trace. Compare task/frame metrics and resource growth separately from temperature/fan observations. Use a physical trace to substantiate device-specific performance conclusions.
