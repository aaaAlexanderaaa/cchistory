#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildLiteArtifact } from './build-lite-artifact.mjs';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const keepTemp = process.argv.includes('--keep-temp');
const skipBuild = process.argv.includes('--skip-build');

async function main() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'cchistory-lite-artifact-verify-'));
  try {
    const manifest = await buildLiteArtifact({
      repoRoot,
      outputRoot: path.join(tempRoot, 'release'),
      skipBuild,
      createTarball: true,
      versionOverride: '0.0.0-verify',
    });
    const extractRoot = path.join(tempRoot, 'installed');
    await mkdir(extractRoot, { recursive: true });
    await execFile('tar', ['-xzf', manifest.tarball_path, '-C', extractRoot]);
    const installedRoot = path.join(extractRoot, path.basename(manifest.artifact_dir));

    await assertNoWorkspaceSpecs(installedRoot);
    const cli = path.join(installedRoot, 'bin', 'cchistory-lite');
    const tui = path.join(installedRoot, 'bin', 'cchistory-lite-tui');
    const version = await execFile(cli, ['--version'], { cwd: extractRoot });
    if (version.stdout.trim() !== '0.3.0') throw new Error(`Unexpected installed Lite version: ${version.stdout}`);
    const tuiHelp = await execFile(tui, ['--help'], { cwd: extractRoot });
    if (!/CC History Lite TUI/u.test(tuiHelp.stdout)) throw new Error('Installed Lite TUI help was unavailable.');

    const fixtureRoot = path.join(repoRoot, 'mock_data', '.codex', 'sessions');
    const launchedTui = await execFile(
      cli,
      ['tui', '--source-root', `codex=${fixtureRoot}`, '--source', 'codex', '--safe', '--limit-files', '1'],
      { cwd: extractRoot, maxBuffer: 8 * 1024 * 1024 },
    );
    if (!/CC History Lite TUI/u.test(launchedTui.stdout) || !/Ephemeral live snapshot/u.test(launchedTui.stdout)) {
      throw new Error(`Installed Lite CLI could not launch the sibling TUI: ${launchedTui.stdout}`);
    }
    const search = await execFile(
      cli,
      ['search', 'mock', '--source-root', `codex=${fixtureRoot}`, '--source', 'codex', '--safe', '--json'],
      { cwd: extractRoot, maxBuffer: 8 * 1024 * 1024 },
    );
    const payload = JSON.parse(search.stdout);
    if (payload.kind !== 'search' || payload.total < 1) {
      throw new Error(`Installed Lite CLI fixture search failed: ${search.stdout}`);
    }
    console.log('[cchistory] standalone Lite artifact verification passed');
    console.log(`[cchistory] verified binaries: ${cli}, ${tui}`);
  } finally {
    if (keepTemp) console.log(`[cchistory] kept verification directory: ${tempRoot}`);
    else await rm(tempRoot, { recursive: true, force: true });
  }
}

async function assertNoWorkspaceSpecs(root) {
  for (const packageJsonPath of await listPackageJsonFiles(root)) {
    const source = await readFile(packageJsonPath, 'utf8');
    if (source.includes('workspace:*')) {
      throw new Error(`Standalone artifact retained a workspace dependency: ${packageJsonPath}`);
    }
  }
}

async function listPackageJsonFiles(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...await listPackageJsonFiles(target));
    else if (entry.name === 'package.json') result.push(target);
  }
  return result;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
