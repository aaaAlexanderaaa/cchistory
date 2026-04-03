#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const modulePath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(modulePath);
const repoRoot = path.resolve(scriptDir, '..');

export const LOCAL_FULL_READ_BUNDLE_STEPS = [
  { label: 'build-cli', cmd: 'pnpm', args: ['--filter', '@cchistory/cli', 'build'] },
  { label: 'build-tui', cmd: 'pnpm', args: ['--filter', '@cchistory/tui', 'build'] },
  { label: 'verify-cli-artifact', cmd: process.execPath, args: [path.join(scriptDir, 'verify-cli-artifact.mjs'), '--skip-build'] },
  { label: 'verify-skeptical-tui-full-snapshot', cmd: process.execPath, args: [path.join(scriptDir, 'verify-skeptical-tui-full-snapshot.mjs')] },
];

export function formatLocalFullReadSummary(totalSeconds, artifactSeconds, tuiSeconds) {
  return `[cchistory] local full-read bundle passed in ${totalSeconds}s (artifact ${artifactSeconds}s, tui ${tuiSeconds}s)`;
}

export async function runLocalFullReadBundle(options = {}) {
  const runStepImpl = options.runPlannedStep ?? runPlannedStep;
  const now = options.now ?? (() => Date.now());
  const log = options.log ?? console.log;

  const startedAt = now();

  await runStepImpl(LOCAL_FULL_READ_BUNDLE_STEPS[0]);
  await runStepImpl(LOCAL_FULL_READ_BUNDLE_STEPS[1]);

  const artifactStart = now();
  await runStepImpl(LOCAL_FULL_READ_BUNDLE_STEPS[2]);
  const artifactSeconds = secondsSince(artifactStart, now);

  const tuiStart = now();
  await runStepImpl(LOCAL_FULL_READ_BUNDLE_STEPS[3]);
  const tuiSeconds = secondsSince(tuiStart, now);

  const totalSeconds = secondsSince(startedAt, now);
  log(formatLocalFullReadSummary(totalSeconds, artifactSeconds, tuiSeconds));
}

async function main() {
  await runLocalFullReadBundle();
}

async function runPlannedStep(step) {
  await runStep(step.label, step.cmd, step.args);
}

async function runStep(label, cmd, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} failed: ${cmd} ${args.join(' ')} exited with code ${code ?? 'null'}${signal ? ` (signal ${signal})` : ''}`));
    });
  });
}

function secondsSince(startedAt, now = () => Date.now()) {
  return Math.round((now() - startedAt) / 1000);
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
