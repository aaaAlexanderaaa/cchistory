import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { access, cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'cchistory-skeptical-tui-full-'));
  const childEnv = { ...process.env, HOME: tempRoot };

  try {
    const storeDir = path.join(tempRoot, 'store');
    const missingStoreDir = path.join(tempRoot, 'missing-store');
    const missingDbPath = path.join(missingStoreDir, 'cchistory.sqlite');

    await seedCodexHome(tempRoot, {
      fileName: 'session.jsonl',
      sessionId: 'codex-tui-session-1',
      cwd: '/workspace/tui-full-snapshot',
      model: 'gpt-5',
      prompt: 'Indexed-only TUI full snapshot prompt',
      reply: 'Indexed-only TUI full snapshot reply.',
      startAt: '2026-03-09T00:00:00.000Z',
    });

    const syncResult = await runBuiltCliCapture(['sync', '--store', storeDir, '--source', 'codex'], tempRoot, childEnv);
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);
    assert.equal(syncResult.stderr.trim(), '');

    await writeCodexSessionFixture(tempRoot, 'session-2.jsonl', {
      sessionId: 'codex-tui-session-2',
      cwd: '/workspace/tui-full-snapshot',
      model: 'gpt-5',
      prompt: 'Live-only full snapshot prompt',
      reply: 'Live-only full snapshot reply.',
      startAt: '2026-03-10T00:00:00.000Z',
    });

    const indexedSearch = await runBuiltTuiCapture(['--store', storeDir, '--search', 'Live-only full snapshot prompt'], tempRoot, childEnv);
    assert.equal(indexedSearch.exitCode, 0, indexedSearch.stderr);
    assert.match(indexedSearch.stdout, /Read Mode: indexed store only/);
    assert.match(indexedSearch.stdout, /Read=indexed-only/);
    assert.match(indexedSearch.stdout, /Results: 0 match\(es\)/);
    assertQuietStderr(indexedSearch, 'indexed TUI search');

    const fullSearch = await runBuiltTuiCapture(
      ['--store', storeDir, '--full', '--source', 'codex', '--search', 'Live-only full snapshot prompt'],
      tempRoot,
      childEnv,
    );
    assert.equal(fullSearch.exitCode, 0, fullSearch.stderr);
    assert.match(fullSearch.stdout, /Store DB: .*full scan in memory/);
    assert.match(fullSearch.stdout, /Read Mode: live full scan in memory/);
    assert.match(fullSearch.stdout, /Read=live-full/);
    assert.match(fullSearch.stdout, /Live-only full snapshot prompt/);
    assertQuietStderr(fullSearch, 'full TUI search');

    const indexedSearchAfterFull = await runBuiltTuiCapture(['--store', storeDir, '--search', 'Live-only full snapshot prompt'], tempRoot, childEnv);
    assert.equal(indexedSearchAfterFull.exitCode, 0, indexedSearchAfterFull.stderr);
    assert.match(indexedSearchAfterFull.stdout, /Results: 0 match\(es\)/);
    assertQuietStderr(indexedSearchAfterFull, 'indexed TUI search after full snapshot');

    const combinedFull = await runBuiltTuiCapture(
      ['--store', storeDir, '--full', '--source', 'codex', '--search', 'Live-only full snapshot prompt', '--source-health'],
      tempRoot,
      childEnv,
    );
    assert.equal(combinedFull.exitCode, 0, combinedFull.stderr);
    assert.match(combinedFull.stdout, /Mode=search/);
    assert.match(combinedFull.stdout, /Read Mode: live full scan in memory/);
    assert.match(combinedFull.stdout, /Read=live-full/);
    assert.match(combinedFull.stdout, /Source Health:/);
    assert.match(combinedFull.stdout, /Live-only full snapshot prompt/);
    assertQuietStderr(combinedFull, 'combined full TUI snapshot');

    await seedCodexHome(tempRoot, {
      fileName: 'session-missing-store.jsonl',
      sessionId: 'codex-tui-missing-store-1',
      cwd: '/workspace/tui-full-snapshot-missing-store',
      model: 'gpt-5',
      prompt: 'Missing store full snapshot prompt',
      reply: 'Missing store full snapshot reply.',
      startAt: '2026-03-11T00:00:00.000Z',
    });

    const missingStoreFull = await runBuiltTuiCapture(
      ['--store', missingStoreDir, '--full', '--source', 'codex', '--search', 'Missing store full snapshot prompt'],
      tempRoot,
      childEnv,
    );
    assert.equal(missingStoreFull.exitCode, 0, missingStoreFull.stderr);
    assert.match(missingStoreFull.stdout, /Store DB: .*missing-store.*full scan in memory/);
    assert.match(missingStoreFull.stdout, /Read Mode: live full scan in memory/);
    assert.match(missingStoreFull.stdout, /Read=live-full/);
    assert.match(missingStoreFull.stdout, /Missing store full snapshot prompt/);
    assertQuietStderr(missingStoreFull, 'missing-store full TUI snapshot');

    await assert.rejects(access(missingDbPath));

    console.log('Skeptical TUI full snapshot verification passed.');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function runBuiltCliCapture(argv, cwd, env = process.env) {
  const cliEntry = path.resolve(scriptDir, '../apps/cli/dist/index.js');
  return await runNodeEntry(cliEntry, argv, cwd, env);
}

async function runBuiltTuiCapture(argv, cwd, env = process.env) {
  const tuiEntry = path.resolve(scriptDir, '../apps/tui/dist/index.js');
  return await runNodeEntry(tuiEntry, argv, cwd, env);
}

async function runNodeEntry(entryPath, argv, cwd, env) {
  return await new Promise((resolve, reject) => {
    execFile(process.execPath, [entryPath, ...argv], { cwd, env }, (error, stdout, stderr) => {
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
}

function assertQuietStderr(result, label) {
  assert.doesNotMatch(result.stderr, /ExperimentalWarning/, `${label} should not emit SQLite experimental warnings`);
  assert.doesNotMatch(result.stderr, /FTS5 unavailable/, `${label} should stay quiet on stderr`);
  assert.equal(result.stderr.trim(), '', `${label} should keep stderr empty`);
}

async function seedCodexHome(tempRoot, input) {
  await mkdir(path.join(tempRoot, '.codex', 'sessions'), { recursive: true });
  await writeCodexSessionFixture(tempRoot, input.fileName, input);
}

async function writeCodexSessionFixture(tempRoot, fileName, input) {
  const startAt = new Date(input.startAt);
  const userAt = new Date(startAt.getTime() + 1000).toISOString();
  const assistantAt = new Date(startAt.getTime() + 2000).toISOString();
  const targetPath = path.join(tempRoot, '.codex', 'sessions', fileName);

  await writeFile(
    targetPath,
    [
      {
        timestamp: input.startAt,
        type: 'session_meta',
        payload: { id: input.sessionId, cwd: input.cwd, model: input.model },
      },
      {
        timestamp: userAt,
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: input.prompt }],
        },
      },
      {
        timestamp: assistantAt,
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: input.reply }],
        },
      },
    ].map((entry) => JSON.stringify(entry)).join('\n'),
    'utf8',
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
