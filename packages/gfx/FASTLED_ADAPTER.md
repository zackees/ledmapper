# FastLED WASM adapter contract

The adapter lives at the FastLED consumer boundary. `@fastled/gfx` receives ordinary JavaScript values and never imports Emscripten, owns a WASM heap, or retains a module pointer.

| FastLED input | Package input | Adapter rule |
| --- | --- | --- |
| screenmap JSON callback | `normalizeScreenmap(value, paneSize)` | Replace atomically; reject zero-point or malformed maps |
| RGB frame callback | `Uint8Array` | Require `ledCount * 3` bytes; copy before returning unless transfer is explicitly enabled |
| strip ordering | normalized `strips[]` offsets/counts | Preserve source order; never reorder pixels |
| source FPS | FLED metadata `video.fps` / caller pacing | Validate 1–240 Hz; renderer does not own sketch timing |
| diameter | screenmap diameter / renderer option | Keep as a visual option, not heap state |
| bloom mode and UI settings | `createGfx`/bloom options | Map only documented numeric/boolean options |
| renderer choice | package capability report | `beautiful` uses shared renderer; FastLED fast backend remains fallback |
| diagnostics | adapter error callback | Include `screenmap`, `frame-length`, `protocol`, or `worker` context |

The initial transport is copy-safe `Uint8Array`. A future SharedArrayBuffer/ring-buffer path must be selected only when `crossOriginIsolated` and the required Atomics capabilities are present; otherwise the adapter uses the copy path. Emscripten heap ownership, Asyncify, and sketch lifecycle remain entirely in FastLED.

`scripts/test-fastled-adapter.mjs` is a FastLED-shaped, DOM-free fixture. It exercises initial/replacement maps, frame-length/order validation, copy ownership, capability reporting, and actionable errors against the package's public core entry point.
