import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { promisify } from 'node:util';
import { buildCliArtifact } from './build-cli-artifact.mjs';

const execFileAsync = promisify(execFileCallback);

async function createFixtureRepo() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'cchistory-cli-artifact-repo-'));

  await mkdir(path.join(repoRoot, 'apps', 'cli', 'dist'), { recursive: true });
  await mkdir(path.join(repoRoot, 'packages', 'domain', 'dist'), { recursive: true });
  await mkdir(path.join(repoRoot, 'packages', 'source-adapters', 'dist'), { recursive: true });
  await mkdir(path.join(repoRoot, 'packages', 'storage', 'dist'), { recursive: true });

  await writeFile(
    path.join(repoRoot, 'package.json'),
    JSON.stringify({
      name: 'cchistory',
      license: 'MIT',
      engines: {
        node: '>=22',
        pnpm: '>=10 <11',
      },
    }, null, 2) + '\n',
    'utf8',
  );

  await writeFile(
    path.join(repoRoot, 'apps', 'cli', 'package.json'),
    JSON.stringify({
      name: '@cchistory/cli',
      version: '9.9.9-test.1',
      type: 'module',
      license: 'MIT',
      bin: { cchistory: './dist/index.js' },
    }, null, 2) + '\n',
    'utf8',
  );

  await writeRuntimePackage(repoRoot, 'packages/domain', '@cchistory/domain');
  await writeRuntimePackage(repoRoot, 'packages/source-adapters', '@cchistory/source-adapters');
  await writeRuntimePackage(repoRoot, 'packages/storage', '@cchistory/storage', {
    './store-layout': {
      types: './dist/store-layout.d.ts',
      default: './dist/store-layout.js',
    },
  });

  await writeFile(path.join(repoRoot, 'packages', 'domain', 'dist', 'index.js'), 'export const domainMarker = "domain-ok";\n', 'utf8');
  await writeFile(path.join(repoRoot, 'packages', 'source-adapters', 'dist', 'index.js'), 'export const sourceMarker = "source-ok";\n', 'utf8');
  await writeFile(path.join(repoRoot, 'packages', 'storage', 'dist', 'index.js'), 'export const storageMarker = "storage-ok";\n', 'utf8');
  await writeFile(path.join(repoRoot, 'packages', 'storage', 'dist', 'store-layout.js'), 'export const layoutMarker = "layout-ok";\n', 'utf8');

  await writeFile(
    path.join(repoRoot, 'apps', 'cli', 'dist', 'index.js'),
    [
      'export async function runCli(args) {',
      '  const { domainMarker } = await import("@cchistory/domain");',
      '  const { sourceMarker } = await import("@cchistory/source-adapters");',
      '  const { storageMarker } = await import("@cchistory/storage");',
      '  process.stdout.write(JSON.stringify({ args, domainMarker, sourceMarker, storageMarker }));',
      '  return 0;',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(path.join(repoRoot, 'apps', 'cli', 'dist', 'bundle.js'), 'export const bundleMarker = true;\n', 'utf8');
  await writeFile(path.join(repoRoot, 'apps', 'cli', 'dist', 'renderers.js'), 'export const rendererMarker = true;\n', 'utf8');
  await writeFile(path.join(repoRoot, 'apps', 'cli', 'dist', 'store.js'), 'export const storeMarker = true;\n', 'utf8');

  return repoRoot;
}

async function writeRuntimePackage(repoRoot, relativeDir, packageName, extraExports = undefined) {
  await writeFile(
    path.join(repoRoot, relativeDir, 'package.json'),
    JSON.stringify({
      name: packageName,
      version: '9.9.9-test.1',
      private: true,
      type: 'module',
      main: './dist/index.js',
      types: './dist/index.d.ts',
      exports: {
        '.': {
          types: './dist/index.d.ts',
          default: './dist/index.js',
        },
        ...(extraExports ?? {}),
      },
    }, null, 2) + '\n',
    'utf8',
  );
}

test('buildCliArtifact creates a standalone CLI artifact with vendored workspace packages', async () => {
  const repoRoot = await createFixtureRepo();
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'cchistory-cli-artifact-output-'));

  try {
    const manifest = await buildCliArtifact({
      repoRoot,
      outputRoot,
      skipBuild: true,
      createTarball: false,
    });

    assert.equal(manifest.kind, 'cchistory-cli-artifact');
    assert.equal(manifest.version, '9.9.9-test.1');
    assert.equal(manifest.tarball_path, null);

    const artifactManifest = JSON.parse(await readFile(path.join(manifest.artifact_dir, 'artifact-manifest.json'), 'utf8'));
    assert.equal(artifactManifest.package_name, 'cchistory-cli-standalone');
    assert.equal(artifactManifest.launchers.posix, 'bin/cchistory');
    assert.equal(artifactManifest.included_packages.length, 3);

    const packageJson = JSON.parse(await readFile(path.join(manifest.artifact_dir, 'package.json'), 'utf8'));
    assert.equal(packageJson.name, 'cchistory-cli-standalone');
    assert.equal(packageJson.version, '9.9.9-test.1');

    const installGuide = await readFile(path.join(manifest.artifact_dir, 'INSTALL.md'), 'utf8');
    assert.match(installGuide, /CLI-only channel/);
    assert.match(installGuide, /Upgrade by replacing/);

    const launcherResult = await execFileAsync(process.execPath, [path.join(manifest.artifact_dir, 'bin', 'cchistory.mjs'), 'probe', 'demo']);
    assert.equal(launcherResult.stderr, '');
    assert.deepEqual(JSON.parse(launcherResult.stdout), {
      args: ['probe', 'demo'],
      domainMarker: 'domain-ok',
      sourceMarker: 'source-ok',
      storageMarker: 'storage-ok',
    });
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
    await rm(outputRoot, { recursive: true, force: true });
  }
});
