# @fastled/gfx

FastLED-compatible LED renderer for the web. Three.js + UnrealBloom + density-aware iris. Two consumers:
- [ledmapper.com](https://www.ledmapper.com/) — the package source lives under `packages/gfx/src/` in this repository.
- [FastLED's wasm compiler](https://github.com/FastLED/FastLED) — pins a strict version of this package and embeds it in its simulator bundle.

> **Status:** `0.x` — surface is still being refined. See [issue #157](https://github.com/zackees/ledmapper/issues/157) for the design conversation; `1.0` ships once the worker variant lands and both consumers are on it.

## Install

```bash
npm install @fastled/gfx three
```

`three` is a peer dependency so the consumer controls the version (range `>=0.170 <0.190`).

## Quick start

Two constructors. Both return the same `Gfx` interface.

```ts
import { createGfx } from '@fastled/gfx';

// Mode A: caller streams pixels.
const gfx = createGfx({
    screenmap: myScreenmapJson,
    parent: document.querySelector('#canvas-slot')!,
    paneSize: 800,
    bloom: { mode: 'auto' },
    showFps: true,
});

gfx.pushFrame(rgbBytes);   // length = points.length * 3
gfx.setDiameter(20);
gfx.setBloom({ mode: 'manual', strength: 1.2 });
gfx.dispose();
```

```ts
import { createGfxFromFled } from '@fastled/gfx';

// Mode B: package owns the screenmap and the frames; you get a player.
const gfx = await createGfxFromFled({
    fled: blobOrArrayBuffer,
    parent: document.querySelector('#canvas-slot')!,
    autoplay: true,
});

gfx.player.play();
gfx.player.seek(2.5);
gfx.player.mountControls(document.querySelector('#controls-strip')!);
```

## FPS counter

Toggle the in-canvas perf overlay with `showFps: true`, then `f` key / click-to-hide / `gfx.setFpsVisible(bool)`. State persists in `localStorage["gfx.fps.visible"]`.

The counter exposes three measured signals so you can tell *renderer* from *frame source* bottlenecks:

```
render: 58 · push: 30 · 16.8ms
```

| Signal | What |
|---|---|
| `renderFps` | Internal animation-loop FPS |
| `pushFps` | Rate at which `pushFrame()` was called |
| `frameTimeMs` | Median inter-frame delta (P50, recent window) |

`gfx.getStats()` returns the same values for programmatic use.

## API surface

```ts
interface Gfx {
    readonly canvas: HTMLCanvasElement;
    readonly wrapper: HTMLElement;
    readonly screenmap: Screenmap;
    readonly overlayCanvas?: HTMLCanvasElement;
    readonly overlayCtx?: CanvasRenderingContext2D;
    pushFrame(rgb: Uint8Array): void;
    setBloom(cfg: BloomConfig): void;
    getBloomStrength(): number;
    setScreenmap(map: unknown): void;
    setDiameter(px: number): void;
    getDiameter(): number;
    setTargetFPS(fps: number): void;
    getStats(): { renderFps: number; pushFps: number; frameTimeMs: number; framesRendered: number };
    mountFpsCounter(el: HTMLElement): void;
    unmountFpsCounter(): void;
    setFpsVisible(v: boolean): void;
    isFpsVisible(): boolean;
    dispose(): void;
}

interface GfxWithPlayer extends Gfx {
    readonly player: Player;
    readonly frames: readonly Uint8Array[];
}
```

`Player` is play / pause / seek / speed / loop with `onTimeUpdate` / `onEnded` and an opt-in `mountControls(el)` for a default UI.

## What's coming

- `createGfxInWorker({ canvas, ... })` — same surface, runs in a Worker, OffscreenCanvas transferred from the main thread. Designed for FastLED's wasm pipeline. See [#157 §2](https://github.com/zackees/ledmapper/issues/157).
- `mode: 'fast'` — WebGL 1.0 quad renderer ported from FastLED's `gfx=0` path.
- Built-in MP4 recording.

## License

ISC.
