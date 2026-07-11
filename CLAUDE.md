# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FastLED Video Mapper (www.ledmapper.com) — a web-based tool suite for mapping video content to physical LED arrays (WS2812/APA102). Built with Vite (SPA with a client-side router), ES modules, and hosted on GitHub Pages.

## Running Locally

```bash
# One-time setup
npm install

# Start dev server (port 8080)
npm run dev

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
