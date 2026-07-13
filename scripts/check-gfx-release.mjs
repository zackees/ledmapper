import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'packages/gfx/package.json'), 'utf8'));
const tag = process.env.GFX_RELEASE_TAG ?? process.env.GITHUB_REF_NAME;
if (tag) {
  const expected = `gfx-v${pkg.version}`;
  if (tag !== expected) throw new Error(`release tag ${tag} does not match ${expected}`);
}
const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--dry-run'], { cwd: join(root, 'packages/gfx'), encoding: 'utf8' }))[0];
const names = new Set(packed.files.map((file) => file.path));
for (const required of ['package.json', 'README.md', 'API.md', 'LICENSE', 'dist/index.js', 'dist/index.d.ts']) {
  if (!names.has(required)) throw new Error(`release tarball missing ${required}`);
}
if ([...names].some((name) => name.startsWith('src/'))) throw new Error('release tarball contains source files');
if (packed.unpackedSize > 600_000) throw new Error(`release tarball exceeds 600 KB unpacked (${packed.unpackedSize})`);
console.log(`@fastled/gfx@${pkg.version}: ${packed.files.length} files, ${packed.unpackedSize} bytes unpacked`);
