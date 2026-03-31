#!/usr/bin/env node

import { execFile as execFileCallback, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildCliArtifact } from './build-cli-artifact.mjs';

const execFileAsync = promisify(execFileCallback);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const keepTemp = process.argv.includes('--keep-temp');

async function main() {
  const cliPackage = JSON.parse(await readFile(path.join(repoRoot, 'apps', 'cli', 'package.json'), 'utf8'));
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'cchistory-cli-artifact-verify-'));
  const outputRoot = path.join(tempRoot, 'artifacts');
  const installRoot = path.join(tempRoot, 'installed');
  const firstVersion = `${cliPackage.version}-verify.1`;
  const secondVersion = `${cliPackage.version}-verify.2`;

  try {
    const firstManifest = await buildCliArtifact({
      repoRoot,
      outputRoot,
      versionOverride: firstVersion,
      createTarball: true,
    });
    if (!firstManifest.tarball_path) {
      throw new Error(`First artifact tarball was not created${firstManifest.tarball_warning ? `: ${firstManifest.tarball_warning}` : ''}`);
    }

    const firstInstallDir = path.join(tempRoot, 'release-1');
    await extractTarball(firstManifest.tarball_path, firstInstallDir);
    const firstExtractedDir = path.join(firstInstallDir, path.basename(firstManifest.artifact_dir));
    await replaceInstall(firstExtractedDir, installRoot);
    const firstTemplates = await runInstalledCli(path.join(installRoot, 'bin', 'cchistory'), ['templates']);
    const firstTemplateList = JSON.parse(firstTemplates.stdout);
    if (!Array.isArray(firstTemplateList) || firstTemplateList.length === 0) {
      throw new Error('Installed CLI did not return the expected template list during first-install verification.');
    }

    const secondManifest = await buildCliArtifact({
      repoRoot,
      outputRoot,
      versionOverride: secondVersion,
      skipBuild: true,
      createTarball: true,
    });
    if (!secondManifest.tarball_path) {
      throw new Error(`Second artifact tarball was not created${secondManifest.tarball_warning ? `: ${secondManifest.tarball_warning}` : ''}`);
    }

    const secondInstallDir = path.join(tempRoot, 'release-2');
    await extractTarball(secondManifest.tarball_path, secondInstallDir);
    const secondExtractedDir = path.join(secondInstallDir, path.basename(secondManifest.artifact_dir));
    await replaceInstall(secondExtractedDir, installRoot);

    const secondTemplates = await runInstalledCli(path.join(installRoot, 'bin', 'cchistory'), ['templates']);
    const secondTemplateList = JSON.parse(secondTemplates.stdout);
    if (!Array.isArray(secondTemplateList) || secondTemplateList.length !== firstTemplateList.length) {
      throw new Error('Upgraded CLI did not preserve the expected template surface.');
    }

    const installedManifest = JSON.parse(await readFile(path.join(installRoot, 'artifact-manifest.json'), 'utf8'));
    if (installedManifest.version !== secondVersion) {
      throw new Error(`Expected upgraded artifact version ${secondVersion}, got ${installedManifest.version}`);
    }

    console.log('[cchistory] standalone CLI artifact verification passed');
    console.log(`[cchistory] first install version: ${firstVersion}`);
    console.log(`[cchistory] upgraded version: ${secondVersion}`);
    console.log(`[cchistory] verified command surface: ${secondTemplateList.length} template profile(s)`);
  } finally {
    if (keepTemp) {
      console.log(`[cchistory] keeping temp verification directory at ${tempRoot}`);
    } else {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}


async function replaceInstall(sourceDir, targetDir) {
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  for (const entry of await readdir(sourceDir)) {
    await cp(path.join(sourceDir, entry), path.join(targetDir, entry), { recursive: true });
  }
}

async function extractTarball(tarballPath, destinationDir) {
  await mkdir(destinationDir, { recursive: true });
  await runCommand({
    cwd: path.dirname(tarballPath),
    cmd: 'tar',
    args: ['-xzf', tarballPath, '-C', destinationDir],
  });
}

async function runInstalledCli(commandPath, args) {
  return execFileAsync(commandPath, args, {
    cwd: path.dirname(path.dirname(commandPath)),
    env: process.env,
  });
}

async function runCommand({ cwd, cmd, args }) {
  await mkdir(cwd, { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: process.env,
      stdio: 'inherit',
    });
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code ?? 'null'}${signal ? ` (signal ${signal})` : ''}`));
    });
    child.on('error', reject);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
