## Goal

Collapse the four tool pages (Demo, Screenmap Maker, Mapped Video Maker, Movie Player) plus the Shape Editor into one page where each tool becomes a *layer* on a shared canvas instead of a standalone route. End state: one canvas, one nav, one transform state, one screenmap source.

**Phases 1–5 are pure refactor with no UX change.** The actual consolidation only happens in Phase 6, after the shared layer is solid.

---

## Phase 1 — Audit ✅

Walked the four tool dirs + shape editor. Severity tags: **HIGH** = literal copy-paste, **MED** = similar pattern with different details, **LOW** = conceptually similar, different implementation.

### Headline findings

| # | Area | Severity | Notes |
|---|------|----------|-------|
| 1 | Canvas / renderer setup | **HIGH** | `createRendererAndScene()` already shared; moviemaker bypasses it |
| 2 | Screenmap loading | **HIGH** | Same parse → fit → mesh flow in every tool; drop-zone only wired in 2 of 5 |
| 3 | File pickers & download buttons | **HIGH** | `qe<HTMLInputElement>` + `addEventListener('change', …)` pasted everywhere |
| 4 | Controls panels / sidebars | **HIGH** | Three independent collapsible-panel implementations |
| 5 | Sliders / number inputs | **HIGH** | Only `wireDiameterSlider` extracted; 8+ moviemaker sliders inline |
| 6 | Dialogs (SweetAlert2) | **MED** | Only moviemaker uses Swal; rest use `alert()` |
| 7 | Status / hint bars | **MED** | Shape Editor has the polished one; others are ad-hoc |
| 8 | Animation loop | **LOW** | `createAnimationLoop` already shared (moviemaker abstains for valid reason) |
| 9 | LocalStorage persistence | **HIGH** | Per-tool keys, ad-hoc try/catch wrappers in each tool |
| 10 | Tailwind class strings | **HIGH** | Same 5 utility combos pasted across templates |
| 11 | Three.js helpers in `three-utils.ts` | **LOW–MED** | Mostly good; bloom-controller config is duplicated between demo & movieplayer |
| 12 | Tool switching | n/a | Router rebuilds tool on every navigation — needs rethink for layered model |

### Top duplicated Tailwind class strings (to hoist into `global.css` as `@apply` component classes)
1. `flex items-center gap-2.5` — slider rows (demo, movieplayer, moviemaker)
2. `flex justify-center items-center gap-6 flex-wrap` — control bars (demo, movieplayer)
3. `flex flex-col items-center gap-2` — vertical button groups (demo, movieplayer)
4. `font-mono text-xs text-lm-text-muted min-w-6 text-right` — slider readouts (demo, movieplayer, moviemaker)
5. `flex flex-wrap gap-1.5` — preset / button rows (everywhere)

---

## Phase 2 — Shared canvas / renderer host

**Status: 70% done already.** `src/three-utils.ts` already provides `createRendererAndScene`, `buildPointsMesh`/`rebuildPointsMesh`, `createCircleTexture`, `createAnimationLoop`. The remaining gaps are:

### What to do
- **Adopt the helper in moviemaker** (`src/moviemaker/moviemaker.ts:115-122`). Currently rolls its own canvas/overlay management because of the GPU blur pipeline. Wrap the renderer construction in `createRendererAndScene` and have the blur pipeline accept the existing renderer as input.
- **Consolidate viewport sizing**: `src/movieplayer/movieplayer.ts:98-115` has a `fitWrapper()` that resizes the wrapper to fit the viewport. Demo uses a fixed `CANVAS_SIZE=800`; movieplayer uses dynamic 1000-px fit. Extract `wireResponsiveCanvas(wrapper, opts)` into `three-utils.ts`.
- **Unify the bloom controller setup** that demo and movieplayer copy almost verbatim (`src/demo/demo.ts:97-109` ↔ `src/movieplayer/movieplayer.ts:132-144`). Both pass the same `DEMO_AUTO_FLOOR`/`MAX_DENSE`/`MAX_SPARSE` profile. Factor a `createDemoStyleBloom(scene, opts)` helper.

### Deliverable
A `SharedSceneContext` type that bundles `{ renderer, scene, camera, overlay, animationLoop, bloomController, fitWrapper }` so layers in Phase 6 can hand off a single object instead of reconstructing five.

---

## Phase 3 — Shared controls components

**Highest-leverage phase.** Hoist sliders, file pickers, panel chrome, and Tailwind utility stacks into reusable building blocks.

### 3a. Slider / number-input factory
- `src/three-utils.ts` already exports `wireDiameterSlider`. Generalize it to `createSliderGroup({ id, label, min, max, value, step, onChange, lsKey? })` that renders the entire label + `<input type=range>` + readout `<span>` row and wires the change event + optional localStorage persistence.
- Add `createDualInput({ numberId, rangeId, … })` for screenmap maker's sync'd pair (`src/screenmap/template.html:29-36`, wired at `screenmap.ts:158-171`).
- **Caller targets**: moviemaker's 8+ inline sliders (blur, sigma, rotation, zoom, brightness, gamma, max-brightness, bloom strength) at `src/moviemaker/template.html:44-95`, plus the dual-input rotate slider in screenmap, plus shape-editor's transform-overlay number inputs (`src/shapeeditor/template.html:60-68`).

### 3b. File picker / download button helpers
- `createFilePicker({ accept, onFile })` returns the hidden `<input type=file>` + visible trigger button and handles the `change` listener uniformly.
- `createDownloadButton({ label, getBlob, filename })` wraps the `download_blob_as_file` calls that demo and movieplayer reinvent (`src/demo/demo.ts:445-490` etc.).
- Standardize on the existing `wireFileDropTarget()` from `src/drag-drop.ts` across **all** five tools (currently only demo + movieplayer use it; screenmap, moviemaker, shapeeditor each implement their own).

### 3c. Panel containers
Three patterns to consolidate:
- `createControlBar()` — the centered horizontal `.controls-container flex justify-center items-center gap-6 flex-wrap` used by demo + movieplayer.
- `createCollapsiblePanel({ title, open, body })` — wraps `<details class="panel"><summary>` used by moviemaker (`src/moviemaker/template.html:18-113`) and shape editor's accordion (`src/shapeeditor/template.html` transform-overlay).
- `createFloatingPanelOverlay()` — for shape editor's draggable transform overlay (the dismiss/collapse work from #102/#103/#104 is the model).

### 3d. Tailwind component classes
Add to `src/styles/global.css`:
```css
.control-row     { @apply flex items-center gap-2.5; }
.control-bar     { @apply flex justify-center items-center gap-6 flex-wrap; }
.button-stack    { @apply flex flex-col items-center gap-2; }
.button-row      { @apply flex flex-wrap gap-1.5; }
.slider-readout  { @apply font-mono text-xs text-lm-text-muted min-w-6 text-right; }
```
Then replace the verbatim utility strings in every `template.html`.

### Deliverable
A new `src/ui/` directory: `controls.ts` (sliders, file pickers, download buttons), `panels.ts` (control-bar, collapsible panel, floating overlay), plus the `@apply` additions in `global.css`. Expect ~200–300 lines of template HTML and ~100 lines of event-wiring code to disappear from the tool entries.

---

## Phase 4 — Shared dialogs

**Status: low duplication today, but pre-position for Phase 6.**

Only `src/moviemaker/moviemaker.ts:1-2` imports SweetAlert2 (`Swal.fire('Webcam Error', …)`); the other tools fall back to `alert()`. The shape editor uses Swal in its Inspect-JSON modal (#95, #97), confirmations, and help overlay.

### What to do
- Create `src/ui/dialogs.ts` with `confirm()`, `error()`, `info()`, `prompt()` wrappers over a lazy-imported Swal (mirrors moviemaker's `import('sweetalert2').then(m => m.default)` pattern).
- Each wrapper takes a `{ title, body, … }` config so dialog styling (dark background, focusCancel default, etc.) is in one place.
- Replace the `alert()` calls in screenmap (`src/screenmap/screenmap.ts:196-220`) and movieplayer with the wrappers.

### Deliverable
`src/ui/dialogs.ts`. Small but pays for itself the moment Phase 6 adds layer-switching confirmations.

---

## Phase 5 — Shared state / context

### 5a. StorageManager
Current state is ad-hoc:
- `src/screenmap-store.ts` namespaces under `ledmapper.screenmap.v2`.
- `src/video-store.ts` for `.rgb` files.
- `src/render/bloom-ui.ts` uses `ledmapper.demo.autoBloom` as a raw `lsKey` parameter.
- Shape editor has its own backup-meta keys.
- Each call site wraps `localStorage.{get,set}Item` in its own `try { … } catch {}`.

Build `src/services/storage.ts` with `createNamespacedStore(namespace)` returning `{ get, set, remove, getJson, setJson }`. Each tool consumes `const store = createNamespacedStore('demo')` and calls `store.set('autoBloom', value)` → `localStorage.setItem('ledmapper.demo.autoBloom', …)`.

### 5b. Shared "current screenmap" context
Today every tool independently calls `parse_screenmap_data_json` → `parseScreenmapMultiStrip` → `centerAndFitPoints` → `rebuildPointsMesh`. A consolidated page will need ONE in-memory screenmap that all layers read.

Extract `src/services/screenmap-context.ts` with a `ScreenmapContext` that holds `{ raw, parsed, multistrip, fitTransform }` and emits change events. Each layer subscribes instead of reparsing.

### 5c. Shared video / playback context
Same pattern for the `.rgb` video that movieplayer + demo both load: one source-of-truth `VideoContext` with frame index, playback state, RAF coordination.

### Deliverable
`src/services/{storage,screenmap-context,video-context}.ts`. This is the load-bearing piece for Phase 6: without it the layered page would still need per-layer parsing.

---

## Phase 6 — Layered single-page consolidation

Final step. Drops the per-route teardown/init cycle in favor of all-tools-loaded-once + visibility toggling.

### Architecture
- `src/router.ts` currently destroys + reinits on every nav (`loadRoute()` → `currentDestroy()` → `appEl.innerHTML = ''` → dynamic import → `init(appEl, spaHistory)`). Replace with a `ToolManager` that holds each tool's state in memory.
- Each tool's `init()` returns `{ activate, deactivate, destroy, render }` instead of just `destroy`.
- On layer switch, the previous layer's animation loop pauses (where applicable) and the new layer's resumes.
- One shared `SharedSceneContext` (Phase 2 deliverable) + one `ScreenmapContext` + one `VideoContext` flow through every layer.

### UX
- A layer-picker UI (probably top-bar tabs or a sidebar) toggles which tool is "in front".
- The URL still updates on layer switch so deep links work and back/forward navigates layers (use the existing `SpaHistory.pushView` from #70).
- The shape editor stays on its own route initially because of its scale; consider it Phase 6.5.

### Deliverable
- `src/tool-manager.ts` + refactor `src/router.ts` to delegate to it.
- Per-tool `init()` signatures updated to the new `{ activate, deactivate, … }` shape.
- One new `src/index.ts` (or refactor of hub) that hosts the layered shell.

---

## Non-goals (for now)

- No URL / routing changes during Phases 2–5. Tools stay at their current routes.
- No UX changes per phase. Each phase must leave every existing flow working identically.
- No new tools or features.
- No new rendering libraries (rule from CLAUDE.md: Three.js points mesh + Canvas 2D only).

## Order of operations / dependencies

```
Phase 1 (audit)  ──┬─► Phase 3 (controls)  ──┐
                   ├─► Phase 4 (dialogs)    ──┤
                   ├─► Phase 5 (state)      ──┤
                   └─► Phase 2 (canvas)     ──┴─► Phase 6 (consolidation)
```

Phases 2–5 are independent and can land in parallel PRs. Phase 6 needs all of them.

## Order to ship the first three PRs

Based on severity + leverage, the recommended first cuts (each its own PR):

1. **PR 1 — `@apply` component classes + slider factory** (Phase 3a + 3d). High visibility, low risk, immediately deletes ~150 lines of template duplication.
2. **PR 2 — File picker / download / drop-zone unification** (Phase 3b). Touches every tool but each diff is mechanical.
3. **PR 3 — `StorageManager`** (Phase 5a). Pre-req for cleaner Phase 6 state handoff; lands without touching UI.
