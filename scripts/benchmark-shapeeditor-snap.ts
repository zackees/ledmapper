#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import {
    computeStripSnapTargets,
    computeStripSnapGeometry,
    resolveStripDragSnap,
    type SnapRulerRef,
    type SnapStripRef,
} from '../src/shapeeditor/strip-snap-targets';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const strips: SnapStripRef[] = [];
const points: [number, number][] = [];
const LEDS_PER_STRIP = 16;
for (let row = 0; row < 20; row++) {
    for (let column = 0; column < 25; column++) {
        const offset = points.length;
        const cx = column * 40;
        const cy = row * 40;
        for (let led = 0; led < LEDS_PER_STRIP; led++) {
            points.push([cx + led * 0.5, cy]);
        }
        strips.push({ offset, count: LEDS_PER_STRIP });
    }
}
const rulers: SnapRulerRef[] = [
    { ax: -20, ay: -20, bx: 980, by: -20 },
    { ax: -20, ay: -20, bx: -20, by: 780 },
    { ax: 0, ay: 0, bx: 400, by: 400 },
];

const buildStarted = performance.now();
const targets = computeStripSnapTargets({
    strips,
    draggedIdx: 0,
    points,
    rulers,
    toleranceWorld: 6,
});
const buildMs = performance.now() - buildStarted;
const startGeometry = computeStripSnapGeometry(points.slice(0, LEDS_PER_STRIP));
if (!startGeometry) throw new Error('benchmark fixture did not produce dragged geometry');

const resolve = (i: number) => resolveStripDragSnap({
    cursorDxPx: 100 + (i % 7),
    cursorDyPx: 100 + (i % 11),
    rawDx: 13 + (i % 17) * 0.01,
    rawDy: 9 + (i % 13) * 0.01,
    startGeometry,
    targets,
    camZoom: 1.25,
    tolerancePx: 6,
    snapEnabled: true,
    shiftBypass: false,
});

for (let i = 0; i < 1000; i++) resolve(i);
const samples: number[] = [];
for (let batch = 0; batch < 200; batch++) {
    const started = performance.now();
    for (let i = 0; i < 100; i++) resolve(batch * 100 + i);
    samples.push((performance.now() - started) / 100);
}
const sorted = samples.slice().sort((a, b) => a - b);
const percentile = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
let gitSha = 'unknown';
try { gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch { /* source archive */ }

const report = {
    contract: 'shapeeditor-snap-v1',
    gitSha,
    runtime: process.version,
    platform: `${os.platform()}-${os.arch()}`,
    cpuCount: os.cpus().length,
    stripCount: strips.length,
    points: points.length,
    targetCounts: { x: targets.x.length, y: targets.y.length, rulerBodies: targets.rulerBodies.length },
    buildMs,
    resolverMs: { p50: percentile(0.50), p95: percentile(0.95), max: sorted[sorted.length - 1] ?? 0 },
};

const outputDir = path.join(root, '.temp', 'benchmarks');
mkdirSync(outputDir, { recursive: true });
const output = path.join(outputDir, `shapeeditor-snap-${Date.now()}.json`);
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, output }, null, 2));
if (report.resolverMs.p95 >= 2) process.exit(1);
