import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const keepTemp = process.argv.includes('--keep-temp');

const excludedRootDirs = new Set(['.git', '.cchistory', '.dev-services']);
const excludedNames = new Set(['.next', 'dist', 'node_modules']);

async function main() {
  const pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  await assertRuntimeContract(pkg.engines ?? {});

  const tempRoot = await mkdtemp(path.join(tmpdir(), 'cchistory-clean-install-'));
  const tempRepo = path.join(tempRoot, 'repo');

  console.log(`[cchistory] creating clean copy at ${tempRepo}`);
  await cp(repoRoot, tempRepo, {
    recursive: true,
    filter: (src) => shouldCopy(src, repoRoot),
    force: true,
    errorOnExist: false,
  });

  const commands = [
    { cwd: tempRepo, cmd: 'pnpm', args: ['install'] },
    { cwd: path.join(tempRepo, 'apps', 'web'), cmd: 'pnpm', args: ['install'] },
    { cwd: tempRepo, cmd: 'pnpm', args: ['run', 'build'] },
  ];

  try {
    for (const command of commands) {
      await runCommand(command);
    }
    console.log('[cchistory] clean install verification passed');
    console.log('[cchistory] verified scope: canonical install path + first non-web build');
  } catch (error) {
    console.error(`[cchistory] clean install verification failed in ${tempRepo}`);
    console.error('[cchistory] rerun with --keep-temp if you want to inspect the temp copy');
    throw error;
  } finally {
    if (keepTemp) {
      console.log(`[cchistory] keeping temp copy at ${tempRepo}`);
    } else {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}

export function shouldCopy(src, rootDir = repoRoot) {
  const rel = path.relative(rootDir, src);
  if (!rel) {
    return true;
  }

  const parts = rel.split(path.sep);
  if (excludedRootDirs.has(parts[0])) {
    return false;
  }
  if (parts.some((part) => excludedNames.has(part))) {
    return false;
  }
  return true;
}

async function assertRuntimeContract(engines) {
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (!Number.isFinite(nodeMajor) || nodeMajor < 22) {
    throw new Error(`Unsupported Node.js version ${process.versions.node}; expected ${engines.node ?? '>=22'}`);
  }

  const pnpmVersion = await captureCommand('pnpm', ['--version']);
  const pnpmMajor = Number(pnpmVersion.trim().split('.')[0]);
  if (!Number.isFinite(pnpmMajor) || pnpmMajor < 10 || pnpmMajor >= 11) {
    throw new Error(`Unsupported pnpm version ${pnpmVersion.trim()}; expected ${engines.pnpm ?? '>=10 <11'}`);
  }
}

function runCommand({ cwd, cmd, args }) {
  return new Promise((resolve, reject) => {
    console.log(`\n[cchistory] (${cwd}) $ ${cmd} ${args.join(' ')}`);
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

function captureCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(`${cmd} ${args.join(' ')} failed: ${stderr || stdout}`));
    });
    child.on('error', reject);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
