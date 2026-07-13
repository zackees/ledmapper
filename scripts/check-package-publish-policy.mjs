import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = join(import.meta.dirname, '..');
const packagesRoot = join(root, 'packages');
const publicPackagePath = join(packagesRoot, 'gfx');

async function packageManifests() {
  const entries = await readdir(packagesRoot, { withFileTypes: true });
  const manifests = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(packagesRoot, entry.name, 'package.json');
    try {
      manifests.push({ path, data: JSON.parse(await readFile(path, 'utf8')) });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return manifests;
}

const manifests = await packageManifests();
const publicManifest = manifests.find(({ path }) => path === join(publicPackagePath, 'package.json'));
if (!publicManifest) throw new Error('packages/gfx/package.json is missing');
if (publicManifest.data.name !== '@fastled/gfx') throw new Error('packages/gfx must be named @fastled/gfx');
if (publicManifest.data.private === true) throw new Error('@fastled/gfx cannot be private');
if (publicManifest.data.publishConfig?.access !== 'public') throw new Error('@fastled/gfx must explicitly publish publicly');

const publishable = manifests.filter(({ data }) => data.private !== true);
if (publishable.length !== 1 || publishable[0].path !== publicManifest.path) {
  const names = publishable.map(({ data }) => data.name).join(', ') || '(none)';
  throw new Error(`only @fastled/gfx may be publishable; found ${names}`);
}

const dependencyFields = ['dependencies', 'optionalDependencies', 'peerDependencies'];
for (const field of dependencyFields) {
  for (const [name, version] of Object.entries(publicManifest.data[field] ?? {})) {
    if (typeof version === 'string' && /^(workspace:|file:)/.test(version)) {
      throw new Error(`@fastled/gfx ${field}.${name} resolves to unpublished workspace ${version}`);
    }
  }
}

const rootManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (!rootManifest.workspaces?.includes('packages/*')) {
  throw new Error('root workspaces must use packages/* so future internal packages are discoverable');
}

const releaseWorkflow = await readFile(join(root, '.github/workflows/publish-gfx.yml'), 'utf8');
if (!releaseWorkflow.includes('working-directory: packages/gfx') || !releaseWorkflow.includes("tags: ['gfx-v*']")) {
  throw new Error('gfx release workflow is not scoped to packages/gfx gfx-v* tags');
}
const workflowFiles = (await readdir(join(root, '.github/workflows'))).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'));
for (const filename of workflowFiles) {
  const text = await readFile(join(root, '.github/workflows', filename), 'utf8');
  if (filename !== 'publish-gfx.yml' && /\bnpm publish\b/.test(text)) {
    throw new Error(`${relative(root, join('.github/workflows', filename))} contains an unmanaged npm publish`);
  }
}

console.log(`package publish policy passed: @fastled/gfx is the only publishable workspace (${manifests.length} package workspace${manifests.length === 1 ? '' : 's'})`);
