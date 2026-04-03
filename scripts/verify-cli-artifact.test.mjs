import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const repoRoot = process.cwd();

test('verify-cli-artifact --skip-build fails clearly when required dist output is missing', async () => {
  const tempRepo = await mkdtemp(path.join(os.tmpdir(), 'cchistory-verify-cli-artifact-'));

  try {
    await mkdir(path.join(tempRepo, 'scripts'), { recursive: true });
    await mkdir(path.join(tempRepo, 'apps', 'cli'), { recursive: true });
    await mkdir(path.join(tempRepo, 'packages', 'domain'), { recursive: true });
    await mkdir(path.join(tempRepo, 'packages', 'source-adapters'), { recursive: true });
    await mkdir(path.join(tempRepo, 'packages', 'storage'), { recursive: true });

    await cp(path.join(repoRoot, 'scripts', 'verify-cli-artifact.mjs'), path.join(tempRepo, 'scripts', 'verify-cli-artifact.mjs'));
    await cp(path.join(repoRoot, 'scripts', 'build-cli-artifact.mjs'), path.join(tempRepo, 'scripts', 'build-cli-artifact.mjs'));
    await cp(path.join(repoRoot, 'package.json'), path.join(tempRepo, 'package.json'));
    await cp(path.join(repoRoot, 'apps', 'cli', 'package.json'), path.join(tempRepo, 'apps', 'cli', 'package.json'));
    await cp(path.join(repoRoot, 'packages', 'domain', 'package.json'), path.join(tempRepo, 'packages', 'domain', 'package.json'));
    await cp(path.join(repoRoot, 'packages', 'source-adapters', 'package.json'), path.join(tempRepo, 'packages', 'source-adapters', 'package.json'));
    await cp(path.join(repoRoot, 'packages', 'storage', 'package.json'), path.join(tempRepo, 'packages', 'storage', 'package.json'));

    const result = await new Promise((resolve, reject) => {
      execFile(process.execPath, ['scripts/verify-cli-artifact.mjs', '--skip-build'], { cwd: tempRepo }, (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') {
          reject(error);
          return;
        }
        resolve({
          exitCode: typeof error?.code === 'number' ? Number(error.code) : 0,
          stdout,
          stderr,
        });
      });
    });

    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.trim(), '');
    assert.match(result.stderr, /Required build output not found:/);
    assert.match(result.stderr, /apps\/cli\/dist/);
    assert.match(result.stderr, /Run `pnpm --filter @cchistory\/cli build` first or omit --skip-build\./);
  } finally {
    await rm(tempRepo, { recursive: true, force: true });
  }
});
