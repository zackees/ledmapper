# Meta: JavaScript -> TypeScript migration (strict typing, 3 phases)

This is the umbrella tracking issue for migrating ledmapper from vanilla JavaScript to strict TypeScript. The work is split across three phases, each with its own sub-issue containing concrete config snippets, file lists, PR slicing, and acceptance criteria.

- **Phase 1 — mechanical conversion to TypeScript:** #37
- **Phase 2 — strict typing, eradicate `any`:** #38
- **Phase 3 — strict TypeScript linting:** #39

## Why migrate

The codebase has grown to ~12k LOC across ~40 source modules, with substantial JSDoc coverage (263 annotation hits across 20 files) that's already half-typed in spirit. A real type system would:

- Catch refactor regressions at compile time instead of in Playwright runs. The `shapeeditor.js` file alone is 6425 LOC and tightly coupled to a custom strips/selection model — strict types would make state-shape changes safe.
- Document the screenmap JSON interchange format, the multi-strip parse result, the `.rgb` video format, the label-layout engine API, and the bloom profile shape as first-class types rather than scattered JSDoc.
- Pair naturally with Vite (zero config — esbuild transpiles TS) and `@types/three`.
- Lock in long-term invariants via type-aware lint rules (no-unsafe-*, switch-exhaustiveness, no-floating-promises).

## Current-state inventory

### Toolchain
- Vite 7 SPA, Tailwind v4, Three.js 0.183, SweetAlert2, no TypeScript today (no `.ts` files, no `tsconfig`, no typecheck step).
- ESLint 10 flat config with `@eslint/js` recommended + a small ruleset.
- `npm run test:unit` runs `node --test tests/unit/*.test.js` — tests import `../../src/*.js` directly, so test imports must be updated when files are renamed.
- Playwright e2e (~25 specs) drive the dev server; they don't import `src/` modules.
- CI: `test.yml` runs `npm ci`, `npm run build`, `npm run lint`, Playwright. No typecheck step yet.

### Source files (LOC)
| File | LOC | Notes |
|---|---|---|
| `src/shapeeditor/shapeeditor.js` | 6425 | Largest file. Three.js + Canvas overlay. Sets `window.__shapeeditorDebug` and `window.__labelLayoutDebug`. |
| `src/moviemaker/moviemaker.js` | 744 | Sets `window.__mmDebug`. Imports `virtual:screenmap-presets`. |
| `src/demo/demo.js` | 673 | |
| `src/screenmap/screenmap.js` | 600 | |
| `src/shapeeditor/strips-model.js` | 380 | Domain model — high payoff for typing. |
| `src/screenmap-store.js` | 369 | localStorage IO with JSON parsing — `unknown` + type guards in Phase 2. |
| `src/moviemaker/blur-pipeline.js` | 354 | GLSL uniforms — type the uniform interface. |
| `src/common.js` | 347 | Heaviest JSDoc coverage. `parse_screenmap_data_json` attaches `.diameter` to a returned array (code smell to fix in Phase 2). |
| `src/movieplayer/movieplayer.js` | 299 | |
| `src/label-layout.js` | 277 | Pure module — ideal early TS target. |
| `src/moviemaker/transforms.js` | 259 | Already heavily JSDoc'd. |
| `src/moviemaker/preview.js` | 246 | |
| `src/three-utils.js` | 195 | Shared Three.js helpers. |
| `src/router.js` | 164 | Dynamic `import()` of tool modules. |
| `src/bloom-utils.js` | 146 | Pure constants + math, fully JSDoc'd. |
| `src/moviemaker/overlay.js` | 144 | |
| `src/shapeeditor/paste-parse.js` | 128 | |
| `src/shapeeditor/selection.js` | 118 | |
| `src/moviemaker/shaders.js` | 112 | GLSL string templates. |
| `src/moviemaker/video-source.js` | 104 | |
| `src/shapeeditor/panel-catalog.js` | 102 | |
| `src/moviemaker/recording.js` | 99 | |
| `src/label-render.js` | 88 | |
| `src/three-bloom.js` | 79 | |
| `src/nav.js` | 68 | |
| `src/drag-drop.js` | 55 | |
| `src/shapeeditor/hints.js` | 47 | |
| `src/shape-presets.js` | 43 | |
| `src/preset-loader.js` | 30 | |
| `src/moviemaker/perf.js` | 18 | Debug helper on `window.__perf`. |
| `src/main.js` | 15 | App entry. |

Tests: 15 unit test files in `tests/unit/` (~3000 LOC) and ~25 Playwright spec files in `tests/e2e/`.

### Module dependency graph (high level)
- `main.js` -> `router.js` + `nav.js`.
- `router.js` -> dynamically imports each tool entry.
- Every tool imports from `common.js`. Most also import `three-utils.js`, `screenmap-store.js`, and `drag-drop.js`.
- `demo.js`, `moviemaker.js`, `movieplayer.js` -> `bloom-utils.js`, `three-bloom.js`.
- `shapeeditor.js` is the only consumer of `shapeeditor/strips-model.js`, `shapeeditor/selection.js`, `shapeeditor/panel-catalog.js`, `shapeeditor/grid-snap.js`, `shapeeditor/hints.js`, `shapeeditor/paste-parse.js`, and `label-render.js` -> `label-layout.js`.
- `moviemaker.js` is the only consumer of the `src/moviemaker/*` sub-modules.
- Unit tests import directly from `src/` via relative paths.

This shape (leaf shared modules feeding tool entry points) is what motivates the **leaves-first** ordering used in every phase.

## The three phases

### Phase 1 — Mechanical conversion (#37)
- Every `.js` in `src/` and `tests/unit/` becomes `.ts`.
- `tsconfig.json` with `strict: true` from day one. `allowJs: true` during the migration interval.
- Types are `any` (or trivially cheap real types) — priority is speed and a green build at every step.
- 7 PRs: scaffolding -> leaf shared modules -> router/main -> hub/demo/movieplayer -> screenmap -> moviemaker cluster -> shapeeditor cluster.
- New CI step: `npm run typecheck` (`tsc --noEmit`) between `lint` and the Playwright suite.
- Test runner switches to `node --import tsx --test tests/unit/*.test.ts`.
- Acceptance: zero `.js` in `src/`/`tests/unit/`, all green, `allowJs` removed at the end.

### Phase 2 — Strict typing, eradicate `any` (#38)
- Define `src/types/domain.ts` first: `ScreenmapJson`, `ScreenmapStrip`, `MultiStripParseResult`, `RgbVideoHeader`, `BloomProfile`, `LabelAnchor`/`LabelPlacement`/`LabelLayoutResult`.
- Replace `any` leaves-inward: shared modules first, tool entries last, shapeeditor budgeted across 2-3 PRs.
- Mid-phase: flip on `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` in one focused PR.
- Type DOM access (`querySelector<HTMLButtonElement>`), event handlers, Three.js objects (renderer, scene, camera, points, materials, uniforms), and debug globals.
- CI: AST-based explicit-`any` counter ratchets the count down each PR; final PR enforces zero.
- 8-10 PRs.

### Phase 3 — Strict TypeScript linting (#39)
- Adopt `typescript-eslint` v8 with `strictTypeChecked` + `stylisticTypeChecked`.
- `no-explicit-any`, the `no-unsafe-*` family, `no-floating-promises`, `no-misused-promises`, `switch-exhaustiveness-check`, `consistent-type-imports`, `no-non-null-assertion`, `prefer-nullish-coalescing`, `prefer-optional-chain` — all errors.
- Convert `tests/e2e/*.spec.js` to `.ts` for uniform lint coverage.
- Lint warnings are CI errors; remove all interim escape hatches.
- 3 PRs.

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Test runner breaks when `tests/unit/*.js` -> `*.ts` (Node 20 can't run TS natively) | High | Adopt `tsx` via `node --import tsx --test`. Phase 1 acceptance criterion. |
| Vite virtual module `virtual:screenmap-presets` lacks a TS declaration | Certain | Add ambient `declare module 'virtual:screenmap-presets'` in Phase 1. |
| `?raw` / `?url` Vite imports lack TS declarations | Certain | Add ambient `declare module '*?raw'` / `'*?url'` in Phase 1. |
| `window.__mmDebug`, `__perf`, `__labelLayoutDebug`, `__shapeeditorDebug` are untyped debug globals | Certain | `declare global { interface Window { ... } }` in Phase 1 (typed `any`); replace with real interfaces in Phase 2. |
| Three.js material union types cause friction (`Points.material` is `Material \| Material[]`) | Medium | Centralised `pointsMaterial(p): PointsMaterial` cast helper in Phase 2; documented in #38. |
| `parse_screenmap_data_json` attaches `.diameter` to a returned array (a code smell) | Medium | Phase 2 introduces `{ points, diameter? }` return shape and migrates call sites in one PR. |
| `screenmap-store.js` parses untrusted JSON from localStorage | Medium | Phase 2 uses `unknown` + type guards, not `any` + cast. Adds a `parseScreenmapJson` validator. |
| `shapeeditor.js` is 6425 LOC and the largest single review surface | High | Single PR for Phase 1 rename (mechanical, low risk). Phase 2 budgets 2-3 PRs for substantive typing (state model, selection, chain mode). |
| Dynamic `import('./hub/hub.js')` strings in `router.js` need extension review | Low | Use bare extensionless specifiers under `moduleResolution: Bundler`; verified working with Vite. |
| GLSL shader strings interact with `Material` `defines`/`uniforms` typing | Low | Strings stay typed `string`. Uniforms get a dedicated interface in `blur-pipeline.ts`. |
| Playwright config / Vite config converted to TS introduces unrelated lint noise | Medium | Keep them as JS through Phase 2; convert only if Phase 3 cleanup deems it worth it. |
| ESLint flat config + typescript-eslint v8 + Node 20 toolchain interactions on Windows | Low | Phase 3 first PR is a thin scaffolding PR that proves the toolchain on CI before bulk edits. |
| Line-ending churn on Windows when bulk-renaming `.js` -> `.ts` | Medium | Use `git mv` per file; verify `core.autocrlf` doesn't poison the diff. |

## CI gating strategy (per phase)

| Step | Phase 1 | Phase 2 | Phase 3 |
|---|---|---|---|
| `npm run build` | required | required | required |
| `npm run lint` (existing) | required | required | replaced by type-aware lint |
| `npm run typecheck` (tsc --noEmit) | **added, required** | required | required |
| `npm run test:unit` | required (via tsx) | required | required |
| `npm test` (Playwright) | required | required | required |
| `npm run count:any` (AST-based) | n/a | **added, ratchets to 0** | n/a (lint rule covers it) |
| `npm run lint` (typescript-eslint strict-type-checked) | n/a | n/a | **added, required, warnings = errors** |

## Headline plan decisions

- **Strict from day one.** `strict: true` in Phase 1. Pragmatic explicit `any` is the escape valve; explicit `any` is allowed by strict mode (only *implicit* `any` is rejected).
- **Leaves-first ordering** in every phase: domain primitives -> shared modules -> tool entries. Shapeeditor (6425 LOC) is always the last cluster.
- **Cluster-per-PR slicing** in Phase 1 (7 PRs), domain-typed sub-clusters in Phase 2 (8-10 PRs), three thin PRs in Phase 3.
- **Test continuity via `tsx`.** No pre-compile step; `node --import tsx --test` keeps the workflow simple and source maps clean.
- **Track explicit-`any` count via TypeScript compiler API**, not grep — AST traversal avoids false positives on string content and identifiers like "many".
- **e2e specs deferred to Phase 3.** They don't import `src/`, so they don't block Phase 1; converting them with the lint config in Phase 3 keeps the rule surface uniform.
- **Configs (`vite.config.js`, `playwright.config.js`, `eslint.config.js`, `scripts/*.mjs`) stay JS** until Phase 3, when conversion is optional and judgement-based.

## Sub-issue checklist

- [ ] #37 — Phase 1: mechanical JS -> TS conversion (strict on, `any` allowed)
- [ ] #38 — Phase 2: strict typing, eradicate every `any`
- [ ] #39 — Phase 3: strict TypeScript linting (typescript-eslint strict-type-checked)
