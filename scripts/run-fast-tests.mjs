#!/usr/bin/env node
import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const watch = args.includes('--watch');
const fileIndex = args.indexOf('--file');
const nameIndex = args.indexOf('--name');
const file = fileIndex >= 0 ? args[fileIndex + 1] : null;
const name = nameIndex >= 0 ? args[nameIndex + 1] : null;

if (fileIndex >= 0 && !file || nameIndex >= 0 && !name) {
  console.error('Usage: run-fast-tests.mjs [--watch] [--file <path>] [--name <regex>]');
  process.exit(2);
}

const files = file
  ? [path.resolve(root, file)]
  : readdirSync(path.join(root, 'tests', 'unit'))
      .filter(entry => entry.endsWith('.test.ts'))
      .sort()
      .map(entry => path.join(root, 'tests', 'unit', entry));

const nodeArgs = ['--import', 'tsx', '--test', '--test-reporter=spec'];
if (watch) nodeArgs.push('--watch');
if (name) nodeArgs.push('--test-name-pattern', name);
nodeArgs.push(...files);

const child = spawn(process.execPath, nodeArgs, { cwd: root, stdio: 'inherit', shell: false });
child.on('exit', code => process.exit(code ?? 1));
child.on('error', error => { console.error(error); process.exit(1); });
