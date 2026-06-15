## Phase 2 — Eradicate `any`, type the domain

Goal: every explicit `any` introduced in Phase 1 is replaced with the real type. The codebase "fits together like a glove" — refactors surface compile errors at the call site, not at runtime.

Depends on Phase 1 being complete.

### Strategy

We type from the **leaves inward**. The shared domain modules feed every tool; once their public APIs are typed, tool modules light up with cascading errors that pinpoint the remaining work.

Recommended order:

1. **Domain primitives.** Define the shared types first in `src/types/domain.ts`:
   - `ScreenmapStrip`, `ScreenmapJson`, `ParsedStripPoint`, `MultiStripParseResult`
   - `RgbVideoHeader`, `RgbFrame` (raw `.rgb` interchange format)
   - `BloomProfile`, `BloomAutoRangeInput` (shape of the constants exported by `bloom-utils.ts`)
   - `LabelAnchor`, `LabelPlacement`, `LabelLayoutResult`, `LabelLayoutEngineOptions` (label-layout engine API)
   - `StripPaletteEntry`, `PinColor`
2. **Shared modules.** Replace `any` in `common.ts`, `bloom-utils.ts`, `label-layout.ts`, `label-render.ts`, `screenmap-store.ts`, `three-utils.ts`, `three-bloom.ts`, `drag-drop.ts`, `preset-loader.ts`, `shape-presets.ts`, `nav.ts`. Convert remaining JSDoc into real TS types and delete the JSDoc annotations. Strip-related modules already have a lot of JSDoc — most of the work here is mechanical translation.
3. **Tool clusters.** Same order as Phase 1: hub, demo, movieplayer, screenmap, moviemaker (8 files), shapeeditor (8 files, biggest).
4. **DOM & event handlers.** Replace `document.querySelector('#foo') as any` with `document.querySelector<HTMLButtonElement>('#foo')`. Annotate `addEventListener` callbacks. Use a tiny `requireEl<T>(root, sel)` helper for the "must exist or throw" pattern that's repeated across tool init functions.
5. **Three.js.** `@types/three` is comprehensive but version-pinned to `three@^0.183.2` — verify a compatible version is installed. Replace `any` on `Renderer`, `Scene`, `Camera`, `Points`, `BufferGeometry`, `Material`, render targets, uniforms. Uniform objects in `moviemaker/blur-pipeline.ts` deserve their own interface.
6. **GLSL shader strings.** Stay typed as `string`. No work.
7. **Debug globals.** Replace the Phase 1 `any` on `Window.__mmDebug` etc. with real interfaces (`MoviemakerDebugHooks`, `PerfCounters`, `ShapeeditorDebugHooks`).
8. **Vite virtual module.** Type `virtual:screenmap-presets` as `ScreenmapPresetManifestEntry[]` based on the actual manifest schema.
9. **Test files.** Tests should consume the real types — many call sites that pass cherry-picked fixture objects will surface here. Fix by widening test fixtures into proper typed factories in `tests/unit/_fixtures.ts`.

### Compiler tightening (done partway through this phase, in one dedicated PR)

After the shared modules are typed (around the midpoint), flip on:

```jsonc
{
  "compilerOptions": {
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

These two surface a wave of new errors that are best handled in one focused PR rather than entangled with domain typing PRs.

### Measuring progress

Track explicit-`any` count in CI and fail the build if it goes up. The cleanest implementation is a one-off script that uses the TypeScript compiler API to walk every source file and count `SyntaxKind.AnyKeyword` AST nodes (no false positives from variable names, comments, or string contents like "many"). Add `npm run count:any` and have CI compare against a checked-in baseline that ratchets down with every PR.

Track the count in the meta issue. Each PR drops it. Last PR of Phase 2: count is 0 and the CI gate becomes "fail if any explicit `any` exists in `src/`".

### Specific data types to define

```ts
// src/types/domain.ts (sketch — final shape worked out during Phase 2)

export interface ScreenmapStrip {
  x: number[];
  y: number[];
  diameter?: number;
}

export interface ScreenmapJson {
  map: Record<string, ScreenmapStrip>;
}

export interface ParsedStripPoint {
  x: number;
  y: number;
  stripKey: string;
  indexInStrip: number;
  globalIndex: number;
}

export interface MultiStripParseResult {
  strips: Array<{ key: string; points: ParsedStripPoint[]; diameter?: number }>;
  allPoints: ParsedStripPoint[];
  totalCount: number;
}

export interface RgbVideoHeader {
  ledCount: number;
  frameCount: number;
  byteLength: number;
}

export interface LabelAnchor {
  id: string;
  x: number;
  y: number;
  text: string;
  width: number;
  height: number;
}

export interface LabelPlacement {
  id: string;
  x: number;
  y: number;
  leader: { x1: number; y1: number; x2: number; y2: number } | null;
}

export interface LabelLayoutResult {
  placements: LabelPlacement[];
  unplaced: string[];
}
```

### Risks

- **Three.js method overloads.** Some `Points.material` accesses are union types in `@types/three`. Cast at the assignment site, not at every read. Helper: `function pointsMaterial(p: Points): PointsMaterial { return p.material as PointsMaterial; }`.
- **`parse_screenmap_data_json` returns an array with a `.diameter` side property.** This is a code smell; replace with `{ points: ParsedStripPoint[]; diameter?: number }` and migrate call sites in one PR.
- **`screenmap-store.ts` JSON-parsing of localStorage.** Use `unknown` + type guards, not `any` + cast. Add a `parseScreenmapJson(raw: string): ScreenmapJson | null` validator.
- **`shapeeditor.ts` is 6425 LOC** and the type cascade will be largest there. Budget 2-3 PRs for it (e.g., state model + selection + chain mode each on their own).

### CI gating for Phase 2

- `typecheck` continues to gate.
- Add `count:any` gate from the second PR onward.
- After the mid-phase tightening PR, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on permanently.

### Acceptance criteria

- [ ] `src/types/domain.ts` exists and is consumed by every shared module.
- [ ] Zero explicit `any` in `src/`, enforced by CI.
- [ ] Zero `as any` casts in `src/`, enforced by grep in CI.
- [ ] `noUncheckedIndexedAccess: true` and `exactOptionalPropertyTypes: true` are enabled in `tsconfig.json`.
- [ ] `Window.__*` debug hooks have real interfaces.
- [ ] All tool entry functions (`init(container: HTMLElement): (() => void) | void`) have a shared `ToolInitFn` type.
- [ ] `tsc --noEmit`, `lint`, `build`, `test:unit`, `test` all green.

### Estimated PR count: 8-10

1 setup + tightening PR, 1 domain-types PR, 1 per shared-module batch (~2), 1 per small tool (3), 2 for moviemaker, 2-3 for shapeeditor.
