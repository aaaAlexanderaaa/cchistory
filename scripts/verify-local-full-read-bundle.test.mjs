import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL_FULL_READ_BUNDLE_STEPS, formatLocalFullReadSummary, runLocalFullReadBundle } from './verify-local-full-read-bundle.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

test('local full-read bundle wrapper preserves the intended verifier chain', () => {
  assert.equal(LOCAL_FULL_READ_BUNDLE_STEPS.length, 4);

  assert.deepEqual(LOCAL_FULL_READ_BUNDLE_STEPS[0], {
    label: 'build-cli',
    cmd: 'pnpm',
    args: ['--filter', '@cchistory/cli', 'build'],
  });

  assert.deepEqual(LOCAL_FULL_READ_BUNDLE_STEPS[1], {
    label: 'build-tui',
    cmd: 'pnpm',
    args: ['--filter', '@cchistory/tui', 'build'],
  });

  assert.equal(LOCAL_FULL_READ_BUNDLE_STEPS[2].label, 'verify-cli-artifact');
  assert.equal(LOCAL_FULL_READ_BUNDLE_STEPS[2].cmd, process.execPath);
  assert.deepEqual(LOCAL_FULL_READ_BUNDLE_STEPS[2].args, [path.join(scriptDir, 'verify-cli-artifact.mjs'), '--skip-build']);

  assert.equal(LOCAL_FULL_READ_BUNDLE_STEPS[3].label, 'verify-skeptical-tui-full-snapshot');
  assert.equal(LOCAL_FULL_READ_BUNDLE_STEPS[3].cmd, process.execPath);
  assert.deepEqual(LOCAL_FULL_READ_BUNDLE_STEPS[3].args, [path.join(scriptDir, 'verify-skeptical-tui-full-snapshot.mjs')]);
});


test('local full-read bundle summary stays concise and includes timing cues', async () => {
  const executed = [];
  const logged = [];
  const timestamps = [0, 1000, 10000, 12000, 38000, 40000];

  await runLocalFullReadBundle({
    runPlannedStep: async (step) => {
      executed.push(step.label);
    },
    now: () => {
      const value = timestamps.shift();
      assert.notEqual(value, undefined, 'expected deterministic fake timestamp');
      return value;
    },
    log: (line) => logged.push(line),
  });

  assert.deepEqual(executed, [
    'build-cli',
    'build-tui',
    'verify-cli-artifact',
    'verify-skeptical-tui-full-snapshot',
  ]);
  assert.deepEqual(logged, [formatLocalFullReadSummary(40, 9, 26)]);
  assert.match(logged[0], /local full-read bundle passed in 40s/);
  assert.match(logged[0], /artifact 9s/);
  assert.match(logged[0], /tui 26s/);
});
