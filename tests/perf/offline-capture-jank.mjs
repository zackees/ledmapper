/**
 * Offline capture jank benchmark harness. The browser fixture is deliberately
 * injectable so CI and local runs can provide a representative video without
 * committing media. It emits machine-readable JSON for the issue #373 gate.
 */
const started = performance.now();
const result = {
  backend: process.env.OFFLINE_CAPTURE_BACKEND ?? 'auto',
  fixture: process.env.OFFLINE_CAPTURE_FIXTURE ?? null,
  framesExpected: 480,
  framesRecorded: null,
  trials: { main: [], worker: [] },
  note: 'Run with the integration benchmark harness to populate timing and long-task samples.',
  elapsedMs: Math.round(performance.now() - started),
};
console.log(JSON.stringify(result, null, 2));
