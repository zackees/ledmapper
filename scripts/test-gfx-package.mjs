import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const fixture = await mkdtemp(join(tmpdir(), 'ledmapper-gfx-consumer-'));

function run(command, args, cwd = fixture) {
  execFileSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' } });
}

try {
  const packDir = join(fixture, 'pack');
  await mkdir(packDir);
  const packJson = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', packDir], {
    cwd: join(root, 'packages/gfx'), encoding: 'utf8',
  }));
  const tarball = join(packDir, packJson[0].filename);
  await writeFile(join(fixture, 'package.json'), JSON.stringify({
    name: 'gfx-packed-consumer', private: true, type: 'module',
    dependencies: { '@fastled/gfx': tarball, three: '^0.183.2' },
    devDependencies: { '@types/three': '^0.184.1' },
  }, null, 2));
  await writeFile(join(fixture, 'consumer.mjs'), `
    import * as main from '@fastled/gfx';
    import * as core from '@fastled/gfx/core';
    import * as fled from '@fastled/gfx/fled';
    import * as worker from '@fastled/gfx/worker';
    if (typeof main.createGfx !== 'function' || typeof core.normalizeScreenmap !== 'function') throw new Error('missing public export');
    if (typeof fled.parseRgbFrames !== 'function' || typeof worker.runGfxWorker !== 'function') throw new Error('missing subpath export');
    const normalized = core.normalizeScreenmap({ map: { strip: { x: [0, 1], y: [0, 0] } } });
    if (normalized.points.length !== 2 || normalized.strips[0].count !== 2) throw new Error('screenmap core contract failed');
    console.log('packed @fastled/gfx consumer contract passed');
  `);
  await writeFile(join(fixture, 'index.html'), '<script type="module" src="./consumer.mjs"></script>');
  await run('npm', ['install', '--ignore-scripts']);
  run(process.execPath, [join(fixture, 'consumer.mjs')]);
  run(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', 'vite-dist']);
} finally {
  await rm(fixture, { recursive: true, force: true });
}
