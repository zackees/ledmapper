---
name: debugging
description: How to debug ledmapper — event log, per-tool debug state, copy-diagnostics payloads, rendering watchdogs, the ?debug panel, and test-side tooling. Use when diagnosing bugs, reading a user's diagnostics paste, investigating a black canvas or a broken recording, or writing debug instrumentation.
---

# Debugging ledmapper

The app records its own evidence. Start every investigation from what it
already captured — not from adding printfs.

## The event log (flight recorder)

`src/debug-log.ts`. Every pipeline event flows through scoped loggers:

```ts
import { createLogger } from './debug-log';
const log = createLogger('mytool');          // scope = module
log.info('screenmap-load', { leds: 256 });   // event = kebab-case, data = small flat JSON
```

- Read it: `window.__lmLog.entries` (structured) or `window.__lmLog.dump()`
  (formatted text) in DevTools or via Playwright `page.evaluate`.
- Levels: `debug < info < warn < error`. Default level is `debug` in dev
  builds, `info` in production. Override at runtime with
  `localStorage['lm:log'] = 'debug'` or a `?lmlog=debug` query param
  (persisted to localStorage, so repro links survive reload).
- `warn`/`error` are ALWAYS recorded and also hit the real console.
- Auto-captured: uncaught errors + unhandled rejections (scope `window`),
  router navigations (scope `router`, event `navigate`).
- Ring buffer holds 500 entries. Log at state boundaries (store read/write,
  source changes, record start/stop/save, tool init/destroy) — not per frame.

## Per-tool debug state

`src/debug-registry.ts` → `window.__lmDebug`. Each mounted tool registers a
live `getState()` (computed at call time, plain JSON) and unregisters on
router teardown:

- `__lmDebug.moviemaker.getState()` — screenmapValid, ledCount, stripCount,
  sourceActive/type, playing, recordingActive, recordFormat
- `__lmDebug.movieplayer.getState()` — frameCount, ledCount, playing, loaded
- `__lmDebug.shapeeditor.getState()` — stripCount, totalPoints, dirty; the
  legacy `window.__shapeeditorDebug` methods object also lives at
  `__lmDebug.shapeeditor.debug`

Prefer `getState()` assertions over pixel/class scraping in Playwright when
the state has no DOM representation. Adding a tool? Register in init,
unregister in the returned destroy, never cache the snapshot.

## Copy diagnostics (user bug reports)

Every `errorDialog()` (src/ui/dialogs.ts) has a **Copy diagnostics** footer
button (payload builder: `src/ui/diagnostics.ts`). It copies a paste-ready
markdown block: `__APP_VERSION__` (git SHA + date, injected in
vite.config.js), route path, UA/viewport/DPR, GPU renderer string, the
error, the `__lmDebug` snapshot, and the tail of the event log. localStorage
appears as key names + sizes only — never values.

**Reading a paste:** check app version first (stale deploy?), then scan the
event trail bottom-up from the error: the last `screenmap-load` /
`source-ready` / `record-*` events tell you what state the failure hit; any
`[watchdog]` warnings name the silent failure directly.

## Watchdogs (silent-failure detectors)

`src/watchdogs.ts`, scope `watchdog`, log-only, armed only while the tab is
visible and the activity is expected:

| event | meaning | threshold |
|---|---|---|
| `context-lost` / `context-restored` | WebGL context died / came back | immediate |
| `video-stalled` | source claims playing but no frames + frozen currentTime | ≥4 s |
| `render-loop-stalled` | RAF frame counter stopped advancing | ~6 s (2 interval ticks) |
| `readback-black` | recording readback all-zero while video is healthy | 30 consecutive frames |

If a user reports "black canvas" or "empty recording" and there's NO
watchdog warning in their trail, suspect state gating (wrong tool state)
rather than the render pipeline.

## The ?debug panel

Append `?debug` to any URL (or set `localStorage['lm:debug-panel']`) —
lazy-loads `src/debug-panel.ts` (zero cost otherwise):

- **stats-gl** overlay: FPS + GPU frame time. Attaches to renderers built by
  `three-utils.createRendererAndScene` (demo/movieplayer/shapeeditor).
  Caveat: moviemaker's blur pipeline builds its own context — no stats there.
- **lil-gui**: live sliders for moviemaker blur/bloom (drives the real DOM
  inputs, so tool state stays single-source-of-truth).
- **eruda**: on-page DevTools console — the only console tablet users have.

For WebGL frame capture (draw-call-by-draw-call), install the **Spector.js
browser extension** — deliberately not bundled.

## Test-side debugging

- `npm test` — unit. `npx playwright test <spec>` — one integration spec
  (auto-starts the dev server).
- Failed Playwright tests auto-attach the page's event log as `lm-log`
  (fixture in tests/integration/fixtures.ts) — check the HTML report or
  trace viewer Attachments tab before re-running anything.
- `@gpu` specs skip in normal CI; they run locally (real GPU) and nightly
  under SwiftShader (`.github/workflows/gpu-nightly.yml`, dispatchable).
  When touching moviemaker/preset-picker/recording, run
  `npx playwright test moviemaker` locally before merging — CI will not
  catch a same-day regression there. Spec-internal waits must scale by
  `GPU_WAIT_SCALE` (tests/helpers/gpu-gate.ts). Perf specs (`@gpu-perf`)
  never run in CI — CPU rendering makes their numbers meaningless.
- Full-pipeline evidence run with screenshots: `node tests/ux/walkthrough.mjs`
  (see tests/ux/README.md).

## Playbook: recording/save produces wrong or no output

1. Get the event trail (diagnostics paste, `__lmLog.dump()`, or the `lm-log`
   test attachment).
2. Walk the expected sequence: `screenmap-load` (with the right source +
   LED count) → `source-ready` → `record-start` → `save-fled` (frames +
   bytes). The first missing/wrong link is the bug.
3. `save-failed` with `no-screenmap-json` means live screenmap state was
   lost — check every load path sets `currentScreenmapJson`
   (src/moviemaker/moviemaker.ts, the #219 regression class).
4. Cross-check `__lmDebug.moviemaker.getState()` against what the UI shows.

## Playbook: canvas is black but nothing errored

1. Trail first: any `context-lost`, `video-stalled`, `render-loop-stalled`,
   `readback-black`? Each names its own fix path.
2. No warnings → open with `?debug`: is stats-gl ticking? Frozen FPS = dead
   loop; ticking FPS + black = data problem (all-zero frames, wrong
   screenmap transform, bloom/brightness gating).
3. `readback-black` while video is healthy = the GPU gather path — capture
   a frame with Spector.js and inspect the blur/gather passes.
4. Reproduce headlessly: the walkthrough harness screenshots every step and
   `probes` in its ux-log.json include canvas luma checks.
