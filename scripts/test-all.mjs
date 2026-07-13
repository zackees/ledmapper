#!/usr/bin/env node
import { spawn } from 'node:child_process';
import process from 'node:process';

const run = (script, args = []) => new Promise(resolve => {
  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', script, ...(args.length ? ['--', ...args] : [])], { stdio: 'inherit' });
  child.on('exit', code => resolve(code ?? 1));
});

const fast = await run('test:fast');
if (fast !== 0) process.exit(fast);
const browser = await run('test:browser');
process.exit(browser);
