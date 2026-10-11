# Playback performance validation

The current comparison uses `browser-tests/compare-playback-performance.cjs`,
synthetic seekable audio, and a pinned official Playwright image with external
networking disabled. It alternates three trials of the pre-extraction web assets
and the current build for each viewport. Each trial measures three seconds of
multilingual playback after fonts and lyric rows are ready.

| Viewport | Before script CPU | After script CPU | Before layout CPU | After layout CPU | Before / after frame sampler |
| --- | ---: | ---: | ---: | ---: | ---: |
| Desktop 1280×720 | 157.97 ms | 161.05 ms | 7.12 ms | 7.07 ms | 60.3 / 60.0 fps |
| Mobile 390×844 | 155.14 ms | 167.24 ms | 6.54 ms | 7.18 ms | 60.0 / 60.0 fps |

Values are medians from this local x64 host, not hardware-independent budgets.
Script/layout values come from Chromium CDP; the frame sampler measures browser
animation-frame delivery, not a guarantee that every lyric or WebGL frame was
painted. This short fixture found no large regression after the extraction.
It does not establish battery consumption, long-session behavior or performance
on a physical mobile device. The later bounded artwork/navigation comparison is described below.

The comparison fails when either CPU metric exceeds both 150% of its baseline
and baseline plus 50 ms. This is a coarse regression guard, not a performance
improvement claim. It accepts local asset directories only; it cannot target a
running Jellyfin installation or call lyric providers.

The pre-extraction asset hashes are recorded in
`browser-tests/visual-baseline-provenance.json`. The same assets supplied the
committed desktop/mobile Chromium, Firefox and WebKit screenshot baselines.
Normal browser acceptance uses `scripts/test-browser.sh`; intentional screenshot
updates require visual review. Older fixed-server performance diaries are not
current acceptance evidence.

## Sustained playback and ownership

`long-session.spec.cjs` adds sixty seconds of actual playback per Chromium
viewport, twelve track/artwork changes, and twelve view hide/show transitions.
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
phones, thermal throttling or real provider/network latency. The three-second
numbers above are historical measurements and do not describe every later build.
Current results and artifact hashes belong in `dist/validation.json`.
