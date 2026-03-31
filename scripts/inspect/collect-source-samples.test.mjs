import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFileCallback);
const scriptPath = path.resolve('scripts/inspect/collect-source-samples.mjs');

async function createFixtureHome() {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'cchistory-source-samples-home-'));

  await mkdir(path.join(homeDir, '.openclaw', 'agents', 'agent-a', 'sessions'), { recursive: true });
  await mkdir(path.join(homeDir, '.local', 'share', 'opencode', 'project', 'workspace-demo', 'storage', 'session'), {
    recursive: true,
  });
  await mkdir(
    path.join(homeDir, '.local', 'share', 'opencode', 'project', 'workspace-demo', 'storage', 'message', 'opencode-official'),
    { recursive: true },
  );
  await mkdir(path.join(homeDir, '.local', 'share', 'opencode', 'storage', 'session'), { recursive: true });
  await mkdir(path.join(homeDir, '.local', 'share', 'opencode', 'storage', 'message', 'opencode-legacy'), {
    recursive: true,
  });
  await mkdir(path.join(homeDir, '.config', 'opencode'), { recursive: true });
  await mkdir(path.join(homeDir, 'workspace-demo', '.opencode'), { recursive: true });
  await mkdir(path.join(homeDir, '.gemini', 'history', 'workspace-a'), { recursive: true });
  await mkdir(path.join(homeDir, '.gemini', 'tmp', 'session-a', 'chats'), { recursive: true });
  await mkdir(path.join(homeDir, '.gemini', 'tmp', 'bin'), { recursive: true });
  await mkdir(path.join(homeDir, '.gemini', 'antigravity'), { recursive: true });

  await writeFile(
    path.join(homeDir, '.openclaw', 'agents', 'agent-a', 'sessions', 'openclaw-fixture.jsonl'),
    '{"type":"user","text":"hello"}\n',
    'utf8',
  );
  await writeFile(
    path.join(homeDir, '.local', 'share', 'opencode', 'project', 'workspace-demo', 'storage', 'session', 'opencode-official.json'),
    JSON.stringify({ id: 'opencode-official', cwd: '/workspace/official' }) + '\n',
    'utf8',
  );
  await writeFile(
    path.join(homeDir, '.local', 'share', 'opencode', 'project', 'workspace-demo', 'storage', 'message', 'opencode-official', '0001.json'),
    JSON.stringify({ id: 'msg-official-1', role: 'user', content: 'official message' }) + '\n',
    'utf8',
  );
  await writeFile(
    path.join(homeDir, '.local', 'share', 'opencode', 'storage', 'session', 'opencode-legacy.json'),
    JSON.stringify({ id: 'opencode-legacy', cwd: '/workspace/legacy' }) + '\n',
    'utf8',
  );
  await writeFile(
    path.join(homeDir, '.local', 'share', 'opencode', 'storage', 'message', 'opencode-legacy', '0001.json'),
    JSON.stringify({ id: 'msg-legacy-1', role: 'assistant', content: 'legacy message' }) + '\n',
    'utf8',
  );
  await writeFile(path.join(homeDir, '.config', 'opencode', 'settings.json'), '{"profile":"demo"}\n', 'utf8');
  await writeFile(path.join(homeDir, 'workspace-demo', '.opencode', 'mastra.json'), '{"workspace":"demo"}\n', 'utf8');
  await writeFile(path.join(homeDir, '.gemini', 'projects.json'), '{"projects":[]}\n', 'utf8');
  await writeFile(path.join(homeDir, '.gemini', 'settings.json'), '{"theme":"dark"}\n', 'utf8');
  await writeFile(path.join(homeDir, '.gemini', 'installation_id'), 'fixture-installation\n', 'utf8');
  await writeFile(path.join(homeDir, '.gemini', 'history', 'workspace-a', '.project_root'), '/workspace/a\n', 'utf8');
  await writeFile(
    path.join(homeDir, '.gemini', 'tmp', 'session-a', 'chats', 'chat-001.json'),
    JSON.stringify({ messages: [{ role: 'user', text: 'hi gemini' }] }) + '\n',
    'utf8',
  );
  await writeFile(path.join(homeDir, '.gemini', 'tmp', 'bin', 'helper'), 'binary\n', 'utf8');
  await writeFile(path.join(homeDir, '.gemini', 'antigravity', 'trace.pb'), 'pb\n', 'utf8');

  return homeDir;
}

test('inspect:collect-source-samples collects requested platform evidence under a neutral manifest shape', async () => {
  const homeDir = await createFixtureHome();
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'cchistory-source-samples-output-'));

  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [
        scriptPath,
        '--platform',
        'openclaw',
        '--platform',
        'opencode',
        '--platform',
        'gemini',
        '--output',
        outputRoot,
      ],
      {
        env: { ...process.env, HOME: homeDir },
      },
    );

    assert.match(stdout, /source sample collection complete/);
    assert.equal(stderr, '');

    const manifest = JSON.parse(await readFile(path.join(outputRoot, 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest.requested_platforms, ['openclaw', 'opencode', 'gemini']);

    assert.deepEqual(manifest.sources.openclaw.checked_roots, [
      {
        kind: 'agent_sessions',
        path: path.join(homeDir, '.openclaw', 'agents'),
        exists: true,
      },
    ]);
    assert.deepEqual(manifest.sources.openclaw.copied_files, [
      '.openclaw/agents/agent-a/sessions/openclaw-fixture.jsonl',
    ]);

    assert.deepEqual(manifest.sources.opencode.checked_roots, [
      {
        kind: 'official_project',
        path: path.join(homeDir, '.local', 'share', 'opencode', 'project'),
        exists: true,
      },
      {
        kind: 'legacy_storage_session',
        path: path.join(homeDir, '.local', 'share', 'opencode', 'storage', 'session'),
        exists: true,
      },
    ]);
    assert.deepEqual(manifest.sources.opencode.copied_files, [
      '.local/share/opencode/project/workspace-demo/storage/message/opencode-official/0001.json',
      '.local/share/opencode/project/workspace-demo/storage/session/opencode-official.json',
      '.local/share/opencode/storage/message/opencode-legacy/0001.json',
      '.local/share/opencode/storage/session/opencode-legacy.json',
    ]);
    assert.match(manifest.sources.opencode.notes[0], /\.config\/opencode/);
    assert.match(manifest.sources.opencode.notes[0], /\.opencode/);

    assert.deepEqual(manifest.sources.gemini.checked_roots, [
      {
        kind: 'gemini_root',
        path: path.join(homeDir, '.gemini'),
        exists: true,
      },
      {
        kind: 'history_project_roots',
        path: path.join(homeDir, '.gemini', 'history'),
        exists: true,
      },
      {
        kind: 'tmp_chat_roots',
        path: path.join(homeDir, '.gemini', 'tmp'),
        exists: true,
      },
    ]);
    assert.deepEqual(manifest.sources.gemini.copied_files, [
      '.gemini/history/workspace-a/.project_root',
      '.gemini/installation_id',
      '.gemini/projects.json',
      '.gemini/settings.json',
      '.gemini/tmp/session-a/chats/chat-001.json',
    ]);
    assert.match(manifest.sources.gemini.notes[0], /\.gemini\/tmp\/bin/);
    assert.match(manifest.sources.gemini.notes[0], /\.gemini\/antigravity/);

    const copiedFilesText = JSON.stringify(manifest.sources);
    assert.equal(copiedFilesText.includes('.config/opencode/settings.json'), false);
    assert.equal(copiedFilesText.includes('.opencode/mastra.json'), false);
    assert.equal(copiedFilesText.includes('.gemini/tmp/bin/helper'), false);
    assert.equal(copiedFilesText.includes('.gemini/antigravity/trace.pb'), false);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test('inspect:collect-source-samples rejects missing platform selection', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [scriptPath], {
      env: process.env,
    }),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /at least one --platform flag is required/);
      return true;
    },
  );
});

test('inspect:collect-source-samples exits non-zero when selected platforms only expose config-like artifacts', async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'cchistory-source-samples-empty-home-'));
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'cchistory-source-samples-empty-output-'));

  await mkdir(path.join(homeDir, '.config', 'opencode'), { recursive: true });
  await mkdir(path.join(homeDir, 'workspace-demo', '.opencode'), { recursive: true });
  await writeFile(path.join(homeDir, '.config', 'opencode', 'settings.json'), '{"profile":"demo"}\n', 'utf8');
  await writeFile(path.join(homeDir, 'workspace-demo', '.opencode', 'mastra.json'), '{"workspace":"demo"}\n', 'utf8');

  try {
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [scriptPath, '--platform', 'openclaw', '--platform', 'opencode', '--output', outputRoot],
        {
          env: { ...process.env, HOME: homeDir },
        },
      ),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /no source sample files were found for the requested platform set/);
        return true;
      },
    );

    const manifest = JSON.parse(await readFile(path.join(outputRoot, 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest.requested_platforms, ['openclaw', 'opencode']);
    assert.equal(manifest.sources.openclaw.exists, false);
    assert.equal(manifest.sources.opencode.exists, false);
    assert.equal(manifest.sources.openclaw.copied_files.length, 0);
    assert.equal(manifest.sources.opencode.copied_files.length, 0);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
    await rm(outputRoot, { recursive: true, force: true });
  }
});
