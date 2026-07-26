#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { chmod, cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDir, '..');
const defaultOutputRootRelative = path.join('dist', 'lite-artifacts');
const artifactPackageName = 'cchistory-lite-standalone';
const appPackages = [
  { sourceDir: path.join('apps', 'lite-cli'), artifactDir: path.join('apps', 'lite-cli') },
  { sourceDir: path.join('apps', 'lite-tui'), artifactDir: path.join('apps', 'lite-tui') },
];
const vendoredPackages = [
  { sourceDir: path.join('packages', 'domain'), packageName: '@cchistory/domain' },
  { sourceDir: path.join('packages', 'canonical'), packageName: '@cchistory/canonical' },
  { sourceDir: path.join('packages', 'source-adapters'), packageName: '@cchistory/source-adapters' },
  { sourceDir: path.join('packages', 'live-runtime'), packageName: '@cchistory/live-runtime' },
];

export async function buildLiteArtifact(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const outputRoot = path.resolve(options.outputRoot ?? path.join(repoRoot, defaultOutputRootRelative));
  const skipBuild = options.skipBuild ?? false;
  const createTarball = options.createTarball ?? true;
  const versionOverride = options.versionOverride;
  const tarCommand = options.tarCommand ?? 'tar';
  const rootPackage = await readJson(path.join(repoRoot, 'package.json'));
  const cliPackage = await readJson(path.join(repoRoot, 'apps', 'lite-cli', 'package.json'));
  const tuiPackage = await readJson(path.join(repoRoot, 'apps', 'lite-tui', 'package.json'));
  if (cliPackage.version !== tuiPackage.version && !versionOverride) {
    throw new Error(`Lite CLI/TUI versions differ: ${cliPackage.version} vs ${tuiPackage.version}.`);
  }
  const version = versionOverride ?? cliPackage.version;
  const artifactName = `${artifactPackageName}-${version}`;
  const artifactDir = path.join(outputRoot, artifactName);
  const tarballPath = path.join(outputRoot, `${artifactName}.tgz`);

  if (!skipBuild) {
    await runCommand({
      cwd: repoRoot,
      cmd: 'pnpm',
      args: ['--filter', '@cchistory/lite-cli', 'build'],
    });
    await runCommand({
      cwd: repoRoot,
      cmd: 'pnpm',
      args: ['--filter', '@cchistory/lite-tui', 'build'],
    });
  }

  for (const appPackage of appPackages) {
    await ensureDirectory(path.join(repoRoot, appPackage.sourceDir, 'dist'));
  }
  for (const vendoredPackage of vendoredPackages) {
    await ensureDirectory(path.join(repoRoot, vendoredPackage.sourceDir, 'dist'));
  }

  await mkdir(outputRoot, { recursive: true });
  await rm(artifactDir, { recursive: true, force: true });
  await rm(tarballPath, { force: true });
  await mkdir(path.join(artifactDir, 'bin'), { recursive: true });
  await mkdir(path.join(artifactDir, 'node_modules', '@cchistory'), { recursive: true });

  for (const appPackage of appPackages) {
    const target = path.join(artifactDir, appPackage.artifactDir, 'dist');
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(repoRoot, appPackage.sourceDir, 'dist'), target, { recursive: true });
  }
  const includedPackages = [];
  for (const vendoredPackage of vendoredPackages) {
    includedPackages.push(await copyVendoredPackage(repoRoot, artifactDir, vendoredPackage));
  }
  await writeLauncherFiles(artifactDir);

  const artifactPackage = {
    name: artifactPackageName,
    version,
    type: 'module',
    license: cliPackage.license ?? rootPackage.license ?? 'UNLICENSED',
    bin: {
      'cchistory-lite': './bin/cchistory-lite.mjs',
      'cchistory-lite-tui': './bin/cchistory-lite-tui.mjs',
    },
    engines: { node: rootPackage.engines?.node ?? '>=22' },
  };
  await writeFile(path.join(artifactDir, 'package.json'), `${JSON.stringify(artifactPackage, null, 2)}\n`, 'utf8');
  await writeFile(
    path.join(artifactDir, 'INSTALL.md'),
    [
      '# Standalone CC History Lite Artifact',
      '',
      `Version: ${version}`,
      '',
      'This directory is a self-contained Lite release closure. It carries both',
      'Lite binaries and every private workspace package required at runtime.',
      'It does not require a CCHistory repository checkout or pnpm workspace links.',
      '',
      '- POSIX: run `./bin/cchistory-lite --help` or `./bin/cchistory-lite-tui --help`.',
      '- Windows: run `bin\\cchistory-lite.cmd --help` or `bin\\cchistory-lite-tui.cmd --help`.',
      '- Upgrade by atomically replacing the extracted artifact directory.',
      '',
    ].join('\n'),
    'utf8',
  );

  const manifest = {
    kind: 'cchistory-lite-artifact',
    package_name: artifactPackageName,
    version,
    created_at: new Date().toISOString(),
    artifact_dir: artifactDir,
    tarball_path: createTarball ? tarballPath : null,
    node_requirement: artifactPackage.engines.node,
    launchers: {
      cli: 'bin/cchistory-lite',
      tui: 'bin/cchistory-lite-tui',
      windows_cli: 'bin/cchistory-lite.cmd',
      windows_tui: 'bin/cchistory-lite-tui.cmd',
    },
    included_packages: includedPackages,
  };
  await writeFile(path.join(artifactDir, 'artifact-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  if (createTarball) {
    await runCommand({
      cwd: outputRoot,
      cmd: tarCommand,
      args: ['-czf', tarballPath, artifactName],
    });
  }
  return manifest;
}

async function copyVendoredPackage(repoRoot, artifactDir, vendoredPackage) {
  const sourceDir = path.join(repoRoot, vendoredPackage.sourceDir);
  const sourcePackage = await readJson(path.join(sourceDir, 'package.json'));
  const targetDir = path.join(artifactDir, 'node_modules', ...vendoredPackage.packageName.split('/'));
  await mkdir(targetDir, { recursive: true });
  await cp(path.join(sourceDir, 'dist'), path.join(targetDir, 'dist'), { recursive: true });
  const generatedPackage = {
    name: vendoredPackage.packageName,
    version: sourcePackage.version,
    private: true,
    type: sourcePackage.type ?? 'module',
    main: sourcePackage.main ?? './dist/index.js',
    types: sourcePackage.types,
    exports: sourcePackage.exports,
  };
  await writeFile(path.join(targetDir, 'package.json'), `${JSON.stringify(generatedPackage, null, 2)}\n`, 'utf8');
  return {
    package_name: vendoredPackage.packageName,
    version: sourcePackage.version,
    relative_path: path.relative(artifactDir, targetDir),
  };
}

async function writeLauncherFiles(artifactDir) {
  const cliModule = '#!/usr/bin/env node\nimport path from "node:path";\nimport process from "node:process";\nimport { fileURLToPath } from "node:url";\nimport { runWithAdaptiveNodeMemory } from "@cchistory/live-runtime";\nimport { runLiteCli } from "../apps/lite-cli/dist/index.js";\nconst binDir = path.dirname(fileURLToPath(import.meta.url));\nprocess.env.PATH = process.env.PATH ? `${binDir}${path.delimiter}${process.env.PATH}` : binDir;\nrunWithAdaptiveNodeMemory(() => runLiteCli(process.argv.slice(2))).then((code) => { process.exitCode = code; });\n';
  const tuiModule = '#!/usr/bin/env node\nimport process from "node:process";\nimport { runWithAdaptiveNodeMemory } from "@cchistory/live-runtime";\nimport { runLiteTui } from "../apps/lite-tui/dist/index.js";\nrunWithAdaptiveNodeMemory(() => runLiteTui(process.argv.slice(2))).then((code) => { process.exitCode = code; });\n';
  const posix = (moduleName) => `#!/usr/bin/env sh\nDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec node "$DIR/${moduleName}" "$@"\n`;
  const windows = (moduleName) => `@echo off\r\nset SCRIPT_DIR=%~dp0\r\nnode "%SCRIPT_DIR%${moduleName}" %*\r\n`;
  const files = [
    ['cchistory-lite.mjs', cliModule],
    ['cchistory-lite-tui.mjs', tuiModule],
    ['cchistory-lite', posix('cchistory-lite.mjs')],
    ['cchistory-lite-tui', posix('cchistory-lite-tui.mjs')],
    ['cchistory-lite.cmd', windows('cchistory-lite.mjs')],
    ['cchistory-lite-tui.cmd', windows('cchistory-lite-tui.mjs')],
  ];
  for (const [name, content] of files) {
    const target = path.join(artifactDir, 'bin', name);
    await writeFile(target, content, 'utf8');
    if (!name.endsWith('.cmd')) await chmod(target, 0o755);
  }
}

async function ensureDirectory(targetPath) {
  const metadata = await stat(targetPath).catch(() => undefined);
  if (!metadata?.isDirectory()) {
    throw new Error(`Required build output not found: ${targetPath}. Omit --skip-build or build the Lite profile first.`);
  }
}

async function readJson(targetPath) {
  return JSON.parse(await readFile(targetPath, 'utf8'));
}

async function runCommand({ cwd, cmd, args }) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: process.env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code ?? 'null'}${signal ? ` (${signal})` : ''}`));
    });
  });
}

function parseArgs(argv) {
  const parsed = { outputRoot: undefined, skipBuild: false, createTarball: true, versionOverride: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--output' && argv[index + 1]) parsed.outputRoot = argv[++index];
    else if (argument.startsWith('--output=')) parsed.outputRoot = argument.slice('--output='.length);
    else if (argument === '--skip-build') parsed.skipBuild = true;
    else if (argument === '--no-tarball') parsed.createTarball = false;
    else if (argument === '--version' && argv[index + 1]) parsed.versionOverride = argv[++index];
    else if (argument.startsWith('--version=')) parsed.versionOverride = argument.slice('--version='.length);
    else if (argument === '--help' || argument === '-h') parsed.help = true;
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('usage: pnpm run lite:artifact -- [--output <dir>] [--skip-build] [--no-tarball] [--version <semver>]');
    return;
  }
  const manifest = await buildLiteArtifact({
    outputRoot: args.outputRoot,
    skipBuild: args.skipBuild,
    createTarball: args.createTarball,
    versionOverride: args.versionOverride,
  });
  console.log(`[cchistory] Lite artifact created at ${manifest.artifact_dir}`);
  if (manifest.tarball_path) console.log(`[cchistory] tarball created at ${manifest.tarball_path}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
