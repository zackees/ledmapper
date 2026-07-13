# @fastled/gfx compatibility contract

The package follows semver. While the package is `0.x`, a minor release may
add public capabilities and a patch release is behavior- and type-compatible.
Once `1.0.0` ships, removing or changing a documented export requires a major
version. Deprecated exports remain for one minor release when practical.

The root entry is the browser/main-thread surface. `@fastled/gfx/core` is
DOM-free and worker-safe, `@fastled/gfx/fled` contains pure FLED/player
helpers, and `@fastled/gfx/worker` is the dedicated-worker entry.

Worker messages carry `protocolVersion`. A worker must reject an unsupported
version with `code: "protocol-mismatch"`; a host must reject a `ready` message
with an unsupported version. Capability names are additive and consumers must
ignore capabilities they do not use.

`pushFrame()` accepts an RGB8 `Uint8Array` with exactly
`screenmap.points.length * 3` bytes. The worker proxy transfers an exact,
detached `ArrayBuffer` when possible and copies a sliced view otherwise.
Consumers must not reuse a transferred buffer. Invalid lengths are rejected
by the renderer boundary. `dispose()` is idempotent and detaches listeners,
stops timers/animation, releases GPU resources, and terminates package-owned
workers.

The package is ESM-only. The supported Three.js peer range is declared in
`package.json`; consumers must run the package compatibility fixtures before
upgrading Three.js or the package version.
