#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const samples = Math.max(1, Number(process.argv.find(arg => arg.startsWith('--samples='))?.split('=')[1] ?? 3));
const command = ['run-fast-tests.mjs'];
const results = [];

for (let index = 0; index < samples; index += 1) {
  const started = performance.now();
  let exitCode = 0;
  try {
    execFileSync(process.execPath, command, { cwd: path.join(root, 'scripts'), stdio: 'pipe', encoding: 'utf8' });
  } catch (error) {
    exitCode = error.status ?? 1;
  }
  results.push({ sample: index + 1, wallMs: Math.round(performance.now() - started), exitCode });
}

const sorted = results.map(result => result.wallMs).sort((a, b) => a - b);
const percentile = (value) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * value))];
const report = {
  command: 'node scripts/run-fast-tests.mjs',
  gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  coldWarm: 'sequential samples',
  samples: results,
  medianWallMs: percentile(0.5),
  p95WallMs: percentile(0.95),
  node: process.version,
  platform: `${os.platform()}-${os.arch()}`,
  cpuCount: os.cpus().length,
};

const outputDir = path.join(root, '.temp', 'benchmarks');
mkdirSync(outputDir, { recursive: true });
const output = path.join(outputDir, `tests-${Date.now()}.json`);
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, output }, null, 2));
if (results.some(result => result.exitCode !== 0)) process.exit(1);
