import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { normalizeScreenmap, parseRgbFrames, prependFledHeader, PixelFormat } from '@fastled/gfx/core';

const fixture = JSON.parse(await readFile(new URL('./fixtures/gfx-parity.json', import.meta.url)));
const reports = [];
for (const layout of fixture.layouts) {
  const x = layout.x ?? [];
  const y = layout.y ?? [];
  if (layout.width) {
    for (let row = 0; row < layout.height; row++) {
      const cols = Array.from({ length: layout.width }, (_, col) => layout.serpentine && row % 2 ? layout.width - 1 - col : col);
      x.push(...cols);
      y.push(...cols.map(() => row));
    }
  }
  const strips = layout.strips ?? [{ x, y }];
  const map = { map: Object.fromEntries(strips.map((strip, index) => [`strip${index + 1}`, strip])) };
  const samples = [];
  let normalized;
  for (let i = 0; i < 8; i++) {
    const start = performance.now();
    normalized = normalizeScreenmap(map, 256);
    samples.push(performance.now() - start);
  }
  const stripCount = normalized.strips.reduce((sum, strip) => sum + strip.count, 0);
  if (normalized.points.length !== layout.count || stripCount !== layout.count) {
    throw new Error(`${layout.name}: point count mismatch`);
  }
  if (normalized.points.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) {
    throw new Error(`${layout.name}: non-finite fitted point`);
  }
  const payload = new Uint8Array(layout.count * 3 * 2);
  payload.fill(255);
  const fled = prependFledHeader(payload, JSON.stringify({ video: { fps: 60 }, layout: layout.name }), PixelFormat.rgb8);
  const parsed = parseRgbFrames(fled, layout.count);
  if (parsed.frames.length !== 2 || parsed.notMultiple || parsed.pixelFormat !== PixelFormat.rgb8 || parsed.isFled !== true) {
    throw new Error(`${layout.name}: FLED frame contract failed`);
  }
  samples.sort((a, b) => a - b);
  reports.push({ name: layout.name, ledCount: layout.count, normalizeMsP50: samples[3], normalizeMsP95: samples[7] });
}

let sha = 'unknown';
try { sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* source archive */ }
console.log(JSON.stringify({
  contract: 'gfx-parity-v1', package: '@fastled/gfx', packageVersion: '0.1.0', gitSha: sha,
  runtime: process.version, backend: 'node-dom-free', reports,
}, null, 2));
