import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { shouldCopy } from './verify-clean-install.mjs';

test('shouldCopy excludes nested node_modules directories from clean-install temp copies', () => {
  const repoRoot = path.join(path.sep, 'repo');

  assert.equal(shouldCopy(path.join(repoRoot, 'node_modules', 'typescript', 'package.json'), repoRoot), false);
  assert.equal(shouldCopy(path.join(repoRoot, 'apps', 'cli', 'node_modules', 'chalk', 'package.json'), repoRoot), false);
  assert.equal(
    shouldCopy(path.join(repoRoot, 'packages', 'storage', 'node_modules', '.bin', 'tsx'), repoRoot),
    false,
  );

  assert.equal(shouldCopy(path.join(repoRoot, 'packages', 'source-adapters', 'src', 'index.ts'), repoRoot), true);
  assert.equal(shouldCopy(path.join(repoRoot, 'packages', 'source-adapters', 'dist', 'index.js'), repoRoot), false);
});
