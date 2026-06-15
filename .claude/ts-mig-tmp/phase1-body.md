## Phase 1 — Mechanical JS → TS conversion (fast, green at every step)

Goal: every `.js` source file in `src/` and `tests/unit/` becomes a `.ts` file, the build stays green, and `tsc --noEmit` passes. **Strict mode is on from day one** — pragmatic `any` is the escape valve, not a loosened compiler.

This is part of the meta migration plan. See the meta issue for context, risk register, and the link to Phase 2 / Phase 3.

### Scope

In scope:
- Add `tsconfig.json` with `strict: true`.
- Add `typescript` + `@types/three` + `@types/node` devDeps.
- Add `npm run typecheck` script (`tsc --noEmit`) and wire it into CI alongside `lint` and `build`.
- Rename every `.js` under `src/` and `tests/unit/` to `.ts`. ESLint config (`eslint.config.js`), Vite config (`vite.config.js`), Playwright config (`playwright.config.js`), and the standalone scripts (`scripts/*.mjs`) stay as JS for this phase — they're not part of the app bundle and converting them adds noise without strictness payoff.
- Where typing is trivially cheap (function returns a `number`, a literal object shape with two fields), use the real type. Otherwise: `any` is acceptable.
- The Vite preset manifest virtual module (`virtual:screenmap-presets`) needs a `.d.ts` declaration.
- The `?raw` / `?url` Vite imports (template HTML, CSS) need ambient declarations.
- `window.__mmDebug`, `window.__perf`, `window.__labelLayoutDebug`, `window.__shapeeditorDebug` need typed `declare global` augmentations (typed as `any` is fine in this phase).

Out of scope:
- Replacing `any` with real types (Phase 2).
- typescript-eslint adoption (Phase 3).
- Converting Playwright `tests/e2e/*.spec.js` (they're black-box browser tests; convert in Phase 3 as a polish step or leave as JS).

### Slicing strategy: cluster-by-cluster, leaf modules first

Doing the whole repo in one PR is reviewable-but-risky on Windows (line-ending churn, git mv detection). Doing it one file at a time is slow and leaves the repo in mixed-mode for weeks. The recommended middle ground is **one PR per module cluster**, in dependency order:

1. **PR 1 — Scaffolding only.** Add `tsconfig.json`, install deps, add `typecheck` script, add ambient declarations (`src/types/vite-env.d.ts`, `src/types/globals.d.ts`), wire CI. No `.js` -> `.ts` renames yet. Verifies the toolchain end-to-end.
2. **PR 2 — Leaf shared modules.** `src/common.js`, `src/bloom-utils.js`, `src/label-layout.js`, `src/label-render.js`, `src/drag-drop.js`, `src/preset-loader.js`, `src/shape-presets.js`, `src/nav.js`, `src/three-utils.js`, `src/three-bloom.js`, `src/screenmap-store.js`. Plus the matching `tests/unit/*.test.js` for each.
3. **PR 3 — Router + main.** `src/router.js`, `src/main.js`.
4. **PR 4 — Hub + Demo + Movieplayer.** Smallest tools first.
5. **PR 5 — Screenmap tool.** `src/screenmap/screenmap.js`.
6. **PR 6 — Moviemaker cluster.** All of `src/moviemaker/*.js` (8 files) — they're tightly coupled, splitting them is more pain than it's worth.
7. **PR 7 — Shapeeditor cluster.** All of `src/shapeeditor/*.js` (8 files). `shapeeditor.js` is the largest file in the repo (6425 LOC) — expect this PR to be the biggest review.

Each PR keeps `tsc --noEmit`, `npm run lint`, `npm run build`, `npm run test:unit`, and `npm test` green. Mixed `.ts`/`.js` mid-migration is supported by `allowJs: true` (see config below).

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": false,
    "exactOptionalPropertyTypes": false,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "allowJs": true,
    "checkJs": false,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "allowImportingTsExtensions": false,
    "useDefineForClassFields": true,
    "types": ["vite/client", "node"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "src/**/*.d.ts", "tests/unit/**/*.ts"],
  "exclude": ["node_modules", "dist", "public"]
}
```

Notes:
- `strict: true` is on day one. `any` is allowed because explicit `any` does not violate strict mode — only *implicit* `any` does. We will write explicit `any` and clean it up in Phase 2.
- `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are deliberately off for Phase 1; they trip up DOM and Three.js patterns. We flip them on as part of Phase 2 once real types land.
- `allowJs: true` is required during the mid-migration interval; remove it at the end of Phase 1 once the last `.js` is gone from `src/` and `tests/unit/`.
- `verbatimModuleSyntax: true` plays well with Vite/esbuild and enforces `import type` discipline, which pays off in Phase 2.
- Import paths stay extensionless of `.ts`. Vite resolves `./common` to `common.ts`; tests run by `node --test` need either `.js` extensions (and we rename the test files to `.ts` and use `--import tsx` or equivalent) — see "Test continuity" below.

### Ambient declarations

`src/types/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />

declare module '*?raw' {
  const content: string;
  export default content;
}

declare module '*?url' {
  const url: string;
  export default url;
}

declare module 'virtual:screenmap-presets' {
  const presets: unknown[];
  export default presets;
}
```

`src/types/globals.d.ts`:

```ts
export {};

declare global {
  interface Window {
    __mmDebug?: any;
    __perf?: any;
    __labelLayoutDebug?: any;
    __shapeeditorDebug?: any;
  }
}
```

(The `any`s here are Phase 1 escape valves — Phase 2 replaces them with real interfaces.)

### Test continuity

`tests/unit/*.test.js` is run by `node --test tests/unit/*.test.js`. After renaming to `.ts`, Node 20 cannot execute `.ts` natively. Two options:

- **Recommended:** add `tsx` as a devDep, change the script to:
  `"test:unit": "node --import tsx --test tests/unit/*.test.ts"`.
  Zero config, no separate compile step, source maps work, imports of `'../../src/foo.js'` need to be rewritten to `'../../src/foo.ts'` or kept extensionless and resolved by `tsx`.
- Alternative: pre-compile `src/` and `tests/unit/` to a `.tmp/` dir with `tsc` and run `node --test .tmp/tests/unit/*.test.js`. Slower, more moving parts.

Playwright e2e specs (`tests/e2e/*.spec.js`) are out of scope for Phase 1 — they don't import `src/` modules, they drive the deployed dev server. Leave as `.js`.

### Per-file gotchas surfaced by the inventory

- `src/router.js` uses dynamic `import('./hub/hub.js')` etc. — these strings must change to `.ts` extensions in source but Vite still emits `.js` in the bundle. With `moduleResolution: Bundler` the bare `./hub/hub` form works; prefer that.
- `src/moviemaker/moviemaker.js` (744 LOC) sets `window.__mmDebug` — covered by globals augmentation above.
- `src/moviemaker/shaders.js` exports GLSL as `string` template literals — already typed correctly, no work.
- `src/moviemaker/perf.js` is a tiny 18-line debug helper using `window.__perf` — straight `any` rename.
- `src/common.js`'s `parse_screenmap_data_json` attaches a `.diameter` property to a returned array. Phase 1 can keep it as `any[]`; Phase 2 introduces a proper typed result.
- `src/screenmap-store.js` is `any`-heavy localStorage IO — Phase 1 rename only.
- Tool entry modules export `init(container)` and re-export `css` from `./xxx.css?url`. The ambient `*?url` declaration above covers both.

### CI gating for Phase 1

The `test.yml` workflow gets a new step between `lint` and Playwright:

```yaml
      - run: npm run typecheck
      - run: npm run test:unit
```

`typecheck` runs `tsc --noEmit` against the `tsconfig.json` above. From PR 1 onward, every PR must pass it.

### Acceptance criteria

- [ ] `tsconfig.json` exists with `strict: true`, `allowJs: true`, `checkJs: false`.
- [ ] `npm run typecheck` script exists and passes.
- [ ] No `.js` files remain in `src/` (except possibly `src/types/*.d.ts` declarations — those are `.d.ts`).
- [ ] No `.js` files remain in `tests/unit/`.
- [ ] `npm run lint`, `npm run build`, `npm run test:unit`, and `npm test` all pass.
- [ ] CI runs `typecheck` between `lint` and `test`.
- [ ] No new runtime regressions: Playwright e2e suite is green.
- [ ] Implicit `any` count is 0 (enforced by `strict: true`). Explicit `any` count is recorded in the meta issue as the Phase 2 starting point.
- [ ] `allowJs` is removed from `tsconfig.json` in the final PR of this phase.

### Estimated PR count: 7

Sized roughly proportionate to LOC. PR 7 (shapeeditor cluster, ~7300 LOC) is the only one likely to need a dedicated review pass.
