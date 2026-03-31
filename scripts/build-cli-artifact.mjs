#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { chmod, cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDir, '..');
const defaultOutputRootRelative = path.join('dist', 'cli-artifacts');
const artifactPackageName = 'cchistory-cli-standalone';
const vendoredPackages = [
  { sourceDir: path.join('packages', 'domain'), packageName: '@cchistory/domain' },
  { sourceDir: path.join('packages', 'source-adapters'), packageName: '@cchistory/source-adapters' },
  { sourceDir: path.join('packages', 'storage'), packageName: '@cchistory/storage' },
];

export async function buildCliArtifact(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const outputRoot = path.resolve(options.outputRoot ?? path.join(repoRoot, defaultOutputRootRelative));
  const versionOverride = options.versionOverride;
  const skipBuild = options.skipBuild ?? false;
  const createTarball = options.createTarball ?? true;
  const tarCommand = options.tarCommand ?? 'tar';

  const rootPackage = await readJson(path.join(repoRoot, 'package.json'));
  const cliPackage = await readJson(path.join(repoRoot, 'apps', 'cli', 'package.json'));
  const version = versionOverride ?? cliPackage.version;
  const createdAt = new Date().toISOString();
  const artifactName = `${artifactPackageName}-${version}`;
  const artifactDir = path.join(outputRoot, artifactName);
  const tarballPath = path.join(outputRoot, `${artifactName}.tgz`);

  if (!skipBuild) {
    await runCommand({
      cwd: repoRoot,
      cmd: 'pnpm',
      args: ['--filter', '@cchistory/cli', 'build'],
    });
  }

  await ensureDirectory(path.join(repoRoot, 'apps', 'cli', 'dist'));
  for (const vendoredPackage of vendoredPackages) {
    await ensureDirectory(path.join(repoRoot, vendoredPackage.sourceDir, 'dist'));
  }

  await mkdir(outputRoot, { recursive: true });
  await rm(artifactDir, { recursive: true, force: true });
  await rm(tarballPath, { force: true });
  await mkdir(artifactDir, { recursive: true });

  await cp(path.join(repoRoot, 'apps', 'cli', 'dist'), path.join(artifactDir, 'dist'), { recursive: true });
  await mkdir(path.join(artifactDir, 'bin'), { recursive: true });
  await mkdir(path.join(artifactDir, 'node_modules', '@cchistory'), { recursive: true });

  await writeLauncherFiles(artifactDir);
  const vendoredMetadata = [];
  for (const vendoredPackage of vendoredPackages) {
    vendoredMetadata.push(await copyVendoredPackage(repoRoot, artifactDir, vendoredPackage));
  }

  const artifactPackage = {
    name: artifactPackageName,
    version,
    private: true,
    type: 'module',
    license: cliPackage.license ?? rootPackage.license ?? 'UNLICENSED',
    bin: {
      cchistory: './bin/cchistory.mjs',
    },
    engines: {
      node: rootPackage.engines?.node ?? '>=22',
    },
  };
  await writeFile(path.join(artifactDir, 'package.json'), `${JSON.stringify(artifactPackage, null, 2)}\n`, 'utf8');

  const installGuide = [
    '# Standalone CCHistory CLI Artifact',
    '',
    `Version: ${version}`,
    '',
    'This artifact packages the canonical `cchistory` CLI plus the internal workspace',
    'packages it needs at runtime. It is a CLI-only channel; it does not install or',
    'manage the API or web runtime.',
    '',
    'Quick use:',
    '',
    '- POSIX shells: run `./bin/cchistory --help` from this directory, or add `bin/` to `PATH`.',
    '- Windows CMD: run `bin\\cchistory.cmd --help` from this directory.',
    '- Upgrade by replacing this extracted directory with a newer artifact version.',
    '',
    'If you need the full self-host repository workflow, continue to use the repo-clone',
    'install path documented in the main README.',
    '',
  ].join('\n');
  await writeFile(path.join(artifactDir, 'INSTALL.md'), installGuide, 'utf8');

  const manifest = {
    kind: 'cchistory-cli-artifact',
    package_name: artifactPackageName,
    version,
    created_at: createdAt,
    repo_root: repoRoot,
    artifact_dir: artifactDir,
    tarball_path: createTarball ? tarballPath : null,
    node_requirement: artifactPackage.engines.node,
    cli_entrypoint: 'dist/index.js',
    launchers: {
      node: 'bin/cchistory.mjs',
      posix: 'bin/cchistory',
      windows_cmd: 'bin/cchistory.cmd',
    },
    included_packages: vendoredMetadata,
  };

  await writeFile(path.join(artifactDir, 'artifact-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  let tarballWarning;
  if (createTarball) {
    try {
      await runCommand({
        cwd: outputRoot,
        cmd: tarCommand,
        args: ['-czf', tarballPath, artifactName],
      });
    } catch (error) {
      manifest.tarball_path = null;
      tarballWarning = formatError(error);
    }
  }

  if (tarballWarning) {
    manifest.tarball_warning = tarballWarning;
  }

  if (tarballWarning) {
    await writeFile(path.join(artifactDir, 'artifact-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
  return manifest;
}

async function copyVendoredPackage(repoRoot, artifactDir, vendoredPackage) {
  const sourcePackageDir = path.join(repoRoot, vendoredPackage.sourceDir);
  const sourcePackageJson = await readJson(path.join(sourcePackageDir, 'package.json'));
  const targetPackageDir = path.join(artifactDir, 'node_modules', ...vendoredPackage.packageName.split('/'));

  await mkdir(targetPackageDir, { recursive: true });
  await cp(path.join(sourcePackageDir, 'dist'), path.join(targetPackageDir, 'dist'), { recursive: true });

  const generatedPackageJson = {
    name: vendoredPackage.packageName,
    version: sourcePackageJson.version,
    private: true,
    type: sourcePackageJson.type ?? 'module',
    main: sourcePackageJson.main ?? './dist/index.js',
    types: sourcePackageJson.types,
    exports: sourcePackageJson.exports,
  };
  await writeFile(path.join(targetPackageDir, 'package.json'), `${JSON.stringify(generatedPackageJson, null, 2)}\n`, 'utf8');

  return {
    package_name: vendoredPackage.packageName,
    version: sourcePackageJson.version,
    relative_path: path.relative(artifactDir, targetPackageDir),
  };
}

async function writeLauncherFiles(artifactDir) {
  const launcherModule = `#!/usr/bin/env node\nimport process from \"node:process\";\nimport { runCli } from \"../dist/index.js\";\nrunCli(process.argv.slice(2)).then((code) => {\n  process.exitCode = code;\n});\n`;
  const posixLauncher = '#!/usr/bin/env sh\nDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec node "$DIR/cchistory.mjs" "$@"\n';
  const windowsLauncher = '@echo off\r\nset SCRIPT_DIR=%~dp0\r\nnode "%SCRIPT_DIR%cchistory.mjs" %*\r\n';

  await writeFile(path.join(artifactDir, 'bin', 'cchistory.mjs'), launcherModule, 'utf8');
  await writeFile(path.join(artifactDir, 'bin', 'cchistory'), posixLauncher, 'utf8');
  await writeFile(path.join(artifactDir, 'bin', 'cchistory.cmd'), windowsLauncher, 'utf8');
  await chmod(path.join(artifactDir, 'bin', 'cchistory.mjs'), 0o755);
  await chmod(path.join(artifactDir, 'bin', 'cchistory'), 0o755);
}

async function ensureDirectory(targetPath) {
  const metadata = await stat(targetPath).catch(() => undefined);
  if (!metadata?.isDirectory()) {
    throw new Error(`Required build output not found: ${targetPath}. Run \`pnpm --filter @cchistory/cli build\` first or omit --skip-build.`);
  }
}

async function readJson(targetPath) {
  return JSON.parse(await readFile(targetPath, 'utf8'));
}

async function runCommand({ cwd, cmd, args }) {
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

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function parseArgs(argv) {
  const parsed = {
    outputRoot: undefined,
    skipBuild: false,
    createTarball: true,
    versionOverride: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output' && argv[index + 1]) {
      parsed.outputRoot = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      parsed.outputRoot = arg.slice('--output='.length);
      continue;
    }
    if (arg === '--skip-build') {
      parsed.skipBuild = true;
      continue;
    }
    if (arg === '--no-tarball') {
      parsed.createTarball = false;
      continue;
    }
    if (arg === '--version' && argv[index + 1]) {
      parsed.versionOverride = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--version=')) {
      parsed.versionOverride = arg.slice('--version='.length);
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    }
  }

  return parsed;
}

function printUsage() {
  console.log('usage: pnpm run cli:artifact -- [--output <dir>] [--skip-build] [--no-tarball] [--version <semver>]');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const manifest = await buildCliArtifact({
    repoRoot: defaultRepoRoot,
    outputRoot: args.outputRoot,
    skipBuild: args.skipBuild,
    createTarball: args.createTarball,
    versionOverride: args.versionOverride,
  });

  console.log(`[cchistory] CLI artifact created at ${manifest.artifact_dir}`);
  if (manifest.tarball_path) {
    console.log(`[cchistory] tarball created at ${manifest.tarball_path}`);
  } else if (manifest.tarball_warning) {
    console.log(`[cchistory] tarball skipped: ${manifest.tarball_warning}`);
  }
  console.log(`[cchistory] launch with ${path.join(manifest.artifact_dir, 'bin', 'cchistory')} --help`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((error) => {
    console.error(formatError(error));
    process.exitCode = 1;
  });
}
