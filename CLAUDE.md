# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FastLED Video Mapper (www.ledmapper.com) — a web-based tool suite for mapping video content to physical LED arrays (WS2812/APA102). Built with Vite (SPA with a client-side router), ES modules, and hosted on GitHub Pages.

## Running Locally

```bash
# One-time setup
npm install

# Start dev server (OS-selected free port)
npm run dev

# Use a specific port when needed
npm run dev -- --port 8080

# Open a visible browser window too. Use this exact command when the user
# says "open/start/turn on the agent browser" or expects a window to pop up.
npm run dev -- --open

# Headless/persistent agent automation only: starts or reuses the server,
# waits for it, and prints DEV-SERVER-READY <url>. This does NOT open a window.
npm run dev:agent
# See the ui-dev-loop skill for automated interaction after startup.

# Production build
npm run build

# Preview production build
npm run preview

# Lint
npm run lint

# Run unit tests (340 tests, ~5s)
npm test

# Run Playwright integration tests on demand (starts dev server)
npm run test:integration
```

Every push/PR runs lint + build + unit + a build-smoke check (`.github/workflows/ci.yml`); the full Playwright integration suite only runs on-demand (manual dispatch or the `integration` PR label, `.github/workflows/integration.yml`) since it's heavier. WebGL-dependent specs (tagged `@gpu` — moviemaker recording, resolution, drag, and fps tests) are skipped whenever `CI` is set without `GPU_CI`, since headless CI Chromium has no real GPU; they instead run nightly under headless SwiftShader rendering via `.github/workflows/gpu-nightly.yml` (also `workflow_dispatch`-able).

## Architecture

**Vite SPA (single `src/index.html` + client-side router in `src/router.js`)** using vanilla JavaScript, Three.js, Tailwind CSS v4, and SweetAlert2. All dependencies managed via npm. ES modules throughout.

**Shared nav bar:** Each tool page includes a shared navigation header (`src/nav.js`). Regular `<a>` links navigate between tools. No iframes.

### File Structure

```
src/              # Source code (Vite root)
  common.js       # Shared utility functions (ES module)
  router.js       # Client-side router (loads tools into single index.html)
  three-utils.js  # Shared Three.js helpers (renderer/scene, points mesh, animation loop)
  nav.js          # Shared navigation bar component
  styles/         # Shared CSS (global.css, nav.css)
  hub/            # Landing page with tool cards
  demo/           # Demo tool
  screenmap/      # Screenmap Maker tool
  moviemaker/     # Mapped Video Maker tool (Three.js + GLSL)
  movieplayer/    # Movie Player tool
  shapeeditor/    # Screenmap Editor tool
public/           # Static assets (served as-is by Vite)
  demo/           # Sample data files (.rgb, .json)
  examples/       # Example projects
tests/
  integration/    # Playwright integration tests (on-demand via `npm run test:integration`)
  unit/           # Fast unit tests (`npm test`)
  fixtures/       # Test data files
  helpers/        # Test utilities (webcam mock, etc.)
```

### Tools (each in `src/<tool>/`)

| Directory | Tool | Core Tech | Purpose |
|-----------|------|-----------|---------|
| `demo/` | Demo | Three.js (`three-utils.js`) | Visualize mapped video playback with sample data |
| `screenmap/` | Screenmap Maker | Canvas 2D | Interactively map physical LED positions, export JSON |
| `moviemaker/` | Mapped Video Maker | Three.js + GLSL | Load video files or webcam, GPU blur, record mapped LED output |
| `movieplayer/` | Movie Player | Three.js (`three-utils.js`) | Play back pre-recorded .fled LED video files |
| `shapeeditor/` | Screenmap Editor | Three.js points mesh + Canvas 2D overlay | View and transform screenmap.json files |

### Shared Code

`src/common.js` — ES module with utility functions imported by each tool:
- `parse_screenmap_data_json()` / `parse_screenmap_data_csv()` / `parse_screenmap_data()` — parse screenmap formats
- `parseScreenmapMultiStrip()` — parse into per-strip structure (`{strips, allPoints, totalCount}`)
- `getStripColors()` / `stripStartEndLabels()` — per-strip colors and Start/End overlay labels
- `centerAndFitPoints()` / `transform_to_center_of_canvas()` — center and scale points to canvas
- `download_blob_as_file()` / `download_binary_as_file()` / `download_text_as_file()` — file downloads
- `estimate_led_size()` — calculate LED diameter from point spacing

`src/three-utils.js` — shared Three.js rendering helpers:
- `createRendererAndScene()` — WebGL renderer + orthographic camera + optional Canvas 2D overlay
- `buildPointsMesh()` / `rebuildPointsMesh()` — LED scatter as a GPU points mesh
- `createCircleTexture()` — round point sprite texture
- `createAnimationLoop()` — frame-rate-limited requestAnimationFrame loop
- `wireDiameterSlider()` — bind a slider to point size

### Data Formats

**Screenmap JSON** (the primary interchange format between tools):
```json
{
  "map": {
    "strip1": {
      "x": [0, 1, 2, ...],
      "y": [0, 0, 0, ...],
      "diameter": 0.25
    }
  }
}
```

**Video files** (`.fled`): Self-describing container — 12-byte header + UTF-8 JSON metadata (embedded screenmap) + raw payload. Pixel formats include `rgb8` (3 bytes / LED). The legacy headerless `.rgb` format is no longer produced or accepted by any tool (issue #133).

### Styling — Tailwind CSS v4

**Setup:** `@tailwindcss/vite` plugin in `vite.config.js`, `@import "tailwindcss"` in `global.css`.

**Theme tokens** defined via `@theme` in `src/styles/global.css`. These generate utility classes:
- Colors: `bg-lm-bg`, `text-lm-text`, `border-lm-accent`, `bg-lm-surface-1`, `text-lm-text-muted`, etc.
- Radii: `rounded-lm`, `rounded-lm-lg`, `rounded-lm-pill`
- Fonts: `font-body` (Outfit), `font-mono` (IBM Plex Mono)
- Moviemaker extras: `bg-mm-surface-1`, `text-mm-danger`, `bg-mm-success`

**Approach: named shared classes via `@apply`, NOT inline utility strings in templates.** Inline Tailwind utility-class strings in `template.html` files are deprecated (issue #119 Phase 3d). Every meaningful UI grouping — slider row, control bar, button group, panel container, etc. — should have a named class defined with `@apply` in `src/styles/global.css` (or a tool's own CSS file for tool-specific groupings) and used semantically in templates.

**Shared layout classes live in `src/styles/global.css`** under the "Layout Components" section:
- `.control-bar` / `.control-bar-start` — top-of-page horizontal wrap container
- `.control-stack` / `.control-stack-start` — vertical stack of related controls
- `.control-row` — label + control + (optional) readout row
- `.button-row` — tight wrap of action buttons / presets
- `.checkbox-row` — inline checkbox + label
- `.slider-readout` / `.slider-readout-wide` — mono numeric readout next to a slider
- `.is-disabled` — faded / non-interactive state for `.control-row` / `.control-stack`

**Per-tool CSS files** (loaded dynamically via `?url` imports + router) still exist for tool-specific concerns. They use `@reference "../styles/global.css"` to access Tailwind utilities in `@apply` directives. These files contain:
- State toggle classes (`.hidden`, `.visible`, `.recording`, `.active-preset`, `.disabled`)
- Keyframe animations
- Pseudo-element styles (`::before`, `::after`)
- Vendor-prefixed selectors (`::-webkit-slider-thumb`, scrollbar)
- Responsive `@media` breakpoints
- Data-attribute layout selectors (`[data-layout="portrait"]`)
- Tool-specific layout groupings (e.g. moviemaker's grid-based `.slider-container`)

**When adding new UI:** Define a named class with `@apply` in `global.css` (shared across tools) or the tool's CSS (one-tool concerns), then reference the class by name in the template. Do not paste raw utility strings into templates.

### Key Patterns

- Rendering rule: **Three.js points mesh (via `three-utils.js`) for LED visualization** (GPU-friendly at thousands of points); **Canvas 2D for interactive editing and text/wire overlays**. Do not add new rendering libraries (p5.js was removed in `7a91434`).
- All JS uses ES module `import`/`export` — no CDN `<script>` tags
- `moviemaker/` uses Three.js with GLSL fragment shaders for GPU-accelerated blur and readback for recording
- UI uses dark theme (bg: `--color-lm-bg` #0a0a0a, accent: `--color-lm-accent` #3b82f6) with SweetAlert2 for dialogs
- Single `src/index.html` loads `global.css` + `nav.css`; tool CSS loaded dynamically by router

## Debugging

Full guide: **`.claude/skills/debugging/SKILL.md`** (playbooks for "recording produces wrong/no output" and "canvas is black but nothing errored"). The essentials:

- **Event log**: `window.__lmLog.dump()` — every pipeline event (screenmap loads, source changes, record start/stop/save, navigations, uncaught errors). Instrument new code via `createLogger(scope)` from `src/debug-log.ts`; verbose tier via `?lmlog=debug`.
- **Per-tool state**: `window.__lmDebug.<tool>.getState()` (`src/debug-registry.ts`) — prefer this over DOM scraping in Playwright for state with no DOM representation.
- **Copy diagnostics**: every error dialog has a button that copies version + state + event trail; read user pastes bottom-up from the error.
- **Watchdogs** (`src/watchdogs.ts`): `context-lost`, `video-stalled`, `render-loop-stalled`, `readback-black` warnings flag silent rendering failures.
- **`?debug` panel**: stats-gl + lil-gui + eruda, lazy-loaded (`src/debug-panel.ts`).
- **GPU specs** (`@gpu`) skip in normal CI and run nightly under SwiftShader — run `npm run test:integration -- moviemaker` locally before merging changes to moviemaker/preset-picker/recording. Failed Playwright tests auto-attach the event log (`lm-log`) to the report.

## Agent UI dev loop

For iterating on UI/behavior changes: **`.claude/skills/ui-dev-loop/SKILL.md`**. Keep one dev server + one `agent-browser` session alive for the whole task; wait on `window.__agentUi.phase === 'ready'` (the HMR sentinel, `src/agent-ui-sentinel.ts`, dev-only) instead of sleeping. Note: CSS edits hot-patch in place; JS/TS edits currently full-reload (no module calls `import.meta.hot.accept()` yet), so in-tool state doesn't survive a JS/TS edit — see the skill for the full caveat.

## Running Playwright tests (blessed command — required)

**Never run `playwright` / `npx playwright test` directly.** Always use `npm run test:integration [-- <spec-or-pattern>]` (`scripts/run-playwright.mjs`) — a `PreToolUse` hook (`.claude/hooks/check-playwright.py`) blocks direct invocations and errors with this same instruction. The blessed runner: reuses an already-running dev server (starts one only if needed, and only tears down the one it started itself), caps `--workers` to a safe default (an unconstrained local run was observed to silently die mid-run — see `.claude/skills/ui-dev-loop/SKILL.md`), and tees full output to a gitignored `.temp/logs/playwright-*.log` while printing a compact tail instead of the full firehose. Runs everything by default; pass a spec name/pattern to scope it, e.g. `npm run test:integration -- moviemaker`. Add `-- --verbose` to stream full output live instead of the tail summary.

## Agent production-video requests

When asked to take a local MP4 (including a file under `E:\video`), apply a
screenmap, record it, and show the result, use the unattended production CLI
instead of trying to drive the interactive recorder. Package exactly the input
MP4 and a file named `screenmap.json` into an input ZIP, serve that ZIP locally,
run `scripts/produce_video_mapping.py` with `--allow-private-network`, extract
the output ZIP, and open the emitted MP4 with `Start-Process`.

For a 16×16 LED grid, use `public/screenmaps/16x16_serpentine.json` unless the
user requests the non-serpentine wiring order. Production MP4s support these
query modes:

- `videoMode=side-by-side` (the default): source video on the left and mapped LED preview on the right.
- `videoMode=mapped-led`: mapped LED preview fills the whole output; use this when the user asks for the mapped LED video itself.

Use `outputFps=30` or `outputFps=60` when the user requests a specific MP4
frame rate. Higher-than-source rates repeat mapped frames while retaining the
source duration; they do not perform motion interpolation.

Auto bloom is enabled by default in production (`autoBloom=1` implicitly). Do
not add `autoBloom=0` unless the user explicitly asks to turn bloom off.

### Production-video development and HDR-bloom review loop

Use the unattended producer as the source of truth for visual changes.  Do not
try to reproduce a production render by manually operating the interactive
recorder: it is slower, less repeatable, and makes frame-to-frame comparison
harder.

#### Inputs, maps, and output locations

- Source material normally lives in `E:\\video` (short clips in
  `E:\\video\\short`). Keep user source videos read-only.
- Put finished mapped MP4s, comparison MP4s, and their final output ZIPs in
  `E:\\video\\short_out`. Do not leave a final result only in a temporary
  directory.
- A per-job temporary directory is appropriate for the input ZIP and for
  extracting the producer ZIP. Remove it after its final artifacts have been
  streamed/copied to `short_out`.
- Use the requested map verbatim. Common dense maps are
  `public/screenmaps/32x32_quad_serpentine.json` and
  `public/screenmaps/64x64_quad_serpentine.json`; use
  `16x16_serpentine.json` for the standard 16x16 wiring. For a diamond panel,
  use `panelRotation=-45` to rotate only the LED shape while keeping the
  source video upright. Do not use legacy `previewRotate=1` unless deliberately
  testing the legacy combined image/panel rotation.

#### Generate one deterministic render

1. Make an input ZIP containing *only* the chosen `.mp4` and a copy of the
   chosen map named exactly `screenmap.json` at the same archive level.
2. Serve that ZIP from a local HTTP server and construct a `/produce/` job URL
   with `v=1`, a percent-encoded `input` URL, `output=mp4`, and the desired
   rendering parameters. Local runs must pass `--allow-private-network`.
3. Run `python scripts/produce_video_mapping.py <job-url> --output-dir
   <final-output-dir> --allow-private-network`. It emits a deterministic
   `<source>-ledmapper-v1.zip`; extract the MP4 directly to `short_out` and
   give it a descriptive, versioned name such as
   `<source>-mapped-64x64-60fps-hdr-bloom-v2.mp4`.
4. Open the resulting MP4 with `Start-Process` for review. Never claim a
   visual improvement without opening the output and checking representative
   frames, especially frame 0, bright highlights, skin/midtones, and deep
   shadows.

Use `videoMode=mapped-led` for the actual mapped output; it is a 1024x1024
video. Use `videoMode=side-by-side` to get the source on the left and mapped
preview on the right. Add `outputFps=60` when requested; this preserves source
duration by repeating mapped frames rather than synthesizing motion. Auto bloom
is on by default. `rotation` rotates source sampling, while `panelRotation`
rotates only the panel shape.

#### Side-by-side comparison and splice review

For source-versus-render review, use the producer's `videoMode=side-by-side`.
For an A/B comparison between two mapped renders, normalize both to the same
1024x1024 geometry/fps and create a visual-only horizontal splice with ffmpeg:

```powershell
ffmpeg -y -i <baseline.mp4> -i <candidate.mp4> `
  -filter_complex "[0:v][1:v]hstack=inputs=2[v]" -map "[v]" -an `
  -c:v libx264 -crf 18 -pix_fmt yuv420p <name>-baseline-left-vs-candidate-right.mp4
Start-Process <name>-baseline-left-vs-candidate-right.mp4
```

The baseline always goes left and the candidate right. Keep both individual
inputs as well as the splice in `short_out`, and use stable versioned names so
the review history remains inspectable. If durations differ, trim to the common
duration before `hstack`; do not let ffmpeg silently freeze the last frame.

#### HDR-bloom tuning protocol

The current quality baseline is the full-resolution GPU HDR composite: a sharp
unbloomed scene plus low/mid/high bloom brackets in linear `RGBA16F`, followed
by one shader composite and one display-sRGB quantization at the canvas. The
GPU implementation is in `src/moviemaker/hdr-bloom-gpu.ts`; the CPU composite
is an oracle/fallback, not the preferred production path. Keep output at
1024x1024. If anti-aliasing is under investigation, render the framebuffer at
2x per axis and downsample in the framebuffer before video readback; do not
increase the delivered video resolution.

When improving this pipeline, work from a fixed source/map/fps and create a
new A/B splice after every meaningful change. Judge the result at known
timestamps rather than from a single still. The target is colorful highlight
bleed that retains hue and local contrast, not a uniformly brighter image.

- Preserve the unbloomed sharp base. Treat bloom as added light, not as a
  replacement for source detail.
- Keep the working buffers linear and float/half-float; convert source sRGB
  values to linear once, composite there, and encode display-sRGB exactly once
  at output. A missing or double transfer conversion lifts shadows severely.
- Use multiple bloom brackets. Select or attenuate them from both local
  white-merge risk (raw LED color versus its bloomed value) and a robust global
  bright-tail/Pareto statistic. Avoid simple mean luminance: black corners of a
  rotated diamond panel make it falsely report a dark scene and over-open the
  bloom/iris response.
- Separate neutral bloom from chromatic bloom. Limit shared RGB/neutral energy
  before it drives colored highlights toward white, but retain a hue-preserving
  chromatic component with a uniform-vector shoulder and a single headroom
  scale. Never independently clip RGB channels, which desaturates halos.
- Favor protecting highlights over brightening shadows. Midtone halos and
  lifted blacks are regressions even if the image appears more luminous.
- Do not rely on aggressive global LED-diameter/iris contraction for exposure.
  Dense grids develop aliasing bands and unstable darkness. Use bloom-bracket
  selection/strength as the primary control; any diameter modulation must be
  subtle, geometry-aware, and temporally smoothed.
- Prime temporal exposure/iris state by feeding repeated copies of the first
  source frame before capture begins, so frame 0 starts settled rather than
  briefly over-bright. Use asymmetric smoothing: contraction on sudden
  brightness should be controlled but not jittery; reopening after a dim scene
  should be slower.

Record the exact job URL parameters, map, source filename, renderer mode, and
candidate-versus-baseline observations alongside each visual experiment. This
makes the same workflow useful for color-management, rotation, sampling, and
future rendering changes—not only HDR bloom.

#### HDR-bloom issue precedents

Read these before retuning bloom or iris behavior; each captures a failure mode
that visual A/B review must continue to guard against:

- [#49](https://github.com/zackees/ledmapper/issues/49): dense maps made bloom
  imperceptible because the automatic envelope attenuated it too far.
- [#51](https://github.com/zackees/ledmapper/issues/51): the auto-bloom range
  and iris attack/decay must be able to reach the visually validated manual
  sweet spot.
- [#53](https://github.com/zackees/ledmapper/issues/53): large LED diameters
  can create wide halos that wash out a panel.
- [#55](https://github.com/zackees/ledmapper/issues/55): iris behavior must be
  geometry-aware so sparse/small dots retain bloom without destabilizing dense
  layouts.
- [#255](https://github.com/zackees/ledmapper/issues/255) and
  [#256](https://github.com/zackees/ledmapper/issues/256): rendering changes
  must preserve source-frame cadence and verified output FPS; visual quality is
  not enough if recording drops or duplicates frames unexpectedly.
