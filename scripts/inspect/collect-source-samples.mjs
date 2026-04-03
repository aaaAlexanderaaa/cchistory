#!/usr/bin/env node

import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const homeDir = os.homedir();
const geminiRoot = path.join(homeDir, '.gemini');
const cursorChatStoreRoot = path.join(homeDir, '.cursor', 'chats');
const codebuddyRoot = path.join(homeDir, '.codebuddy');
const supportedPlatforms = ['openclaw', 'opencode', 'gemini', 'cursor-chat-store', 'codebuddy', 'lobechat'];

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.platforms.length === 0) {
    printUsage('at least one --platform flag is required');
    process.exitCode = 1;
    return;
  }

  const invalidPlatforms = args.platforms.filter((platform) => !supportedPlatforms.includes(platform));
  if (invalidPlatforms.length > 0) {
    printUsage(`unsupported platform value(s): ${invalidPlatforms.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const requestedPlatforms = uniqueStrings(args.platforms);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputRoot = args.output ? path.resolve(args.output) : path.join(repoRoot, '.cchistory', 'inspections', `source-samples-${timestamp}`);
  const filesRoot = path.join(outputRoot, 'files');
  const copiedAcrossPlatforms = new Set();

  await mkdir(filesRoot, { recursive: true });

  const sources = {};
  for (const platform of requestedPlatforms) {
    sources[platform] = await collectPlatformSamples(platform, filesRoot, copiedAcrossPlatforms);
  }

  const manifest = {
    created_at: new Date().toISOString(),
    host_home: homeDir,
    output_root: outputRoot,
    requested_platforms: requestedPlatforms,
    sources,
  };

  await writeFile(path.join(outputRoot, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  const copiedCount = Object.values(sources).reduce((total, source) => total + source.copied_files.length, 0);
  if (copiedCount === 0) {
    console.error('[cchistory] no source sample files were found for the requested platform set');
    console.error(`[cchistory] wrote empty manifest to ${path.join(outputRoot, 'manifest.json')}`);
    process.exitCode = 1;
    return;
  }

  console.log('[cchistory] source sample collection complete');
  console.log(`[cchistory] wrote manifest to ${path.join(outputRoot, 'manifest.json')}`);
  for (const platform of requestedPlatforms) {
    console.log(`[cchistory] ${platform}: copied ${sources[platform].copied_files.length} file(s)`);
  }
}

async function collectLobeChat(filesRoot, copiedAcrossPlatforms) {
  const candidateRoot = path.join(homeDir, '.config', 'lobehub-storage');
  const jsonFiles = await listFiles(candidateRoot, (filePath) => filePath.endsWith('.json'));
  const copiedFiles = [];

  for (const filePath of jsonFiles) {
    const relativePath = await copyHomeRelativePath(filePath, filesRoot, copiedAcrossPlatforms);
    if (relativePath) {
      copiedFiles.push(relativePath);
    }
  }

  return {
    checked_roots: [
      {
        kind: 'candidate_local_root',
        path: candidateRoot,
        exists: await pathExists(candidateRoot),
      },
    ],
    exists: copiedFiles.length > 0,
    copied_files: copiedFiles.sort(),
    notes: [
      'Collect all JSON under ~/.config/lobehub-storage only as candidate review evidence; transcript-bearing boundaries are still unverified and must be decided after real-sample review.',
    ],
  };
}

function parseArgs(argv) {
  const parsed = {
    output: undefined,
    platforms: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output' && argv[index + 1]) {
      parsed.output = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      parsed.output = arg.slice('--output='.length);
      continue;
    }
    if (arg === '--platform' && argv[index + 1]) {
      parsed.platforms.push(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--platform=')) {
      parsed.platforms.push(arg.slice('--platform='.length));
    }
  }

  return parsed;
}

function printUsage(problem) {
  if (problem) {
    console.error(`[cchistory] ${problem}`);
  }
  console.error('[cchistory] usage: pnpm run inspect:collect-source-samples -- --platform <slot> [--platform <slot> ...] [--output <dir>]');
  console.error(`[cchistory] supported platforms: ${supportedPlatforms.join(', ')}`);
}

async function collectPlatformSamples(platform, filesRoot, copiedAcrossPlatforms) {
  switch (platform) {
    case 'openclaw':
      return collectOpenClaw(filesRoot, copiedAcrossPlatforms);
    case 'opencode':
      return collectOpenCode(filesRoot, copiedAcrossPlatforms);
    case 'gemini':
      return collectGeminiCli(filesRoot, copiedAcrossPlatforms);
    case 'cursor-chat-store':
      return collectCursorChatStore(filesRoot, copiedAcrossPlatforms);
    case 'codebuddy':
      return collectCodeBuddy(filesRoot, copiedAcrossPlatforms);
    case 'lobechat':
      return collectLobeChat(filesRoot, copiedAcrossPlatforms);
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

async function collectOpenClaw(filesRoot, copiedAcrossPlatforms) {
  const baseDir = path.join(homeDir, '.openclaw', 'agents');
  const sessionFiles = await listFiles(baseDir, (filePath) =>
    filePath.endsWith('.jsonl') && path.basename(path.dirname(filePath)) === 'sessions',
  );
  const copiedFiles = [];

  for (const filePath of sessionFiles) {
    const relativePath = await copyHomeRelativePath(filePath, filesRoot, copiedAcrossPlatforms);
    if (relativePath) {
      copiedFiles.push(relativePath);
    }
  }

  return {
    checked_roots: [
      {
        kind: 'agent_sessions',
        path: baseDir,
        exists: await pathExists(baseDir),
      },
    ],
    exists: copiedFiles.length > 0,
    copied_files: copiedFiles.sort(),
    notes: ['Treat only ~/.openclaw/agents/*/sessions/*.jsonl as transcript-bearing evidence for sample collection.'],
  };
}

async function collectOpenCode(filesRoot, copiedAcrossPlatforms) {
  const projectRoot = path.join(homeDir, '.local', 'share', 'opencode', 'project');
  const legacySessionRoot = path.join(homeDir, '.local', 'share', 'opencode', 'storage', 'session');
  const configRoot = path.join(homeDir, '.config', 'opencode');
  const workspaceConfigPattern = path.join(homeDir, '*', '.opencode');
  const sessionFiles = [
    ...(await listFiles(projectRoot, (filePath) => filePath.endsWith('.json') && path.basename(path.dirname(filePath)) === 'session')),
    ...(await listFiles(legacySessionRoot, (filePath) => filePath.endsWith('.json') && path.basename(path.dirname(filePath)) === 'session')),
  ];
  const copiedFiles = new Set();

  for (const sessionFile of sessionFiles) {
    const sessionRelativePath = await copyHomeRelativePath(sessionFile, filesRoot, copiedAcrossPlatforms);
    if (sessionRelativePath) {
      copiedFiles.add(sessionRelativePath);
    }

    const sessionId = await readOpenCodeSessionId(sessionFile);
    if (!sessionId) {
      continue;
    }

    const storageDir = path.dirname(path.dirname(sessionFile));
    const messageDir = path.join(storageDir, 'message', sessionId);
    const messageFiles = await listFiles(messageDir, (filePath) => filePath.endsWith('.json'));
    for (const messageFile of messageFiles) {
      const messageRelativePath = await copyHomeRelativePath(messageFile, filesRoot, copiedAcrossPlatforms);
      if (messageRelativePath) {
        copiedFiles.add(messageRelativePath);
      }
    }
  }

  return {
    checked_roots: [
      {
        kind: 'official_project',
        path: projectRoot,
        exists: await pathExists(projectRoot),
      },
      {
        kind: 'legacy_storage_session',
        path: legacySessionRoot,
        exists: await pathExists(legacySessionRoot),
      },
    ],
    exists: copiedFiles.size > 0,
    copied_files: [...copiedFiles].sort(),
    notes: [
      `Intentionally ignore config-like OpenCode paths such as ${configRoot} and workspace-local ${workspaceConfigPattern} because they are not transcript-bearing evidence.`,
    ],
  };
}

async function collectGeminiCli(filesRoot, copiedAcrossPlatforms) {
  const topLevelCandidates = [
    path.join(geminiRoot, 'projects.json'),
    path.join(geminiRoot, 'settings.json'),
    path.join(geminiRoot, 'installation_id'),
  ];
  const projectRootFiles = await collectGeminiProjectRootFiles();
  const chatFiles = await collectGeminiChatFiles();
  const copiedFiles = new Set();

  for (const candidate of [...topLevelCandidates, ...projectRootFiles, ...chatFiles]) {
    const relativePath = await copyHomeRelativePath(candidate, filesRoot, copiedAcrossPlatforms);
    if (relativePath) {
      copiedFiles.add(relativePath);
    }
  }

  return {
    checked_roots: [
      {
        kind: 'gemini_root',
        path: geminiRoot,
        exists: await pathExists(geminiRoot),
      },
      {
        kind: 'history_project_roots',
        path: path.join(geminiRoot, 'history'),
        exists: await pathExists(path.join(geminiRoot, 'history')),
      },
      {
        kind: 'tmp_chat_roots',
        path: path.join(geminiRoot, 'tmp'),
        exists: await pathExists(path.join(geminiRoot, 'tmp')),
      },
    ],
    exists: copiedFiles.size > 0,
    copied_files: [...copiedFiles].sort(),
    notes: [
      'Intentionally ignore ~/.gemini/tmp/bin/* and ~/.gemini/antigravity/* because they are not Gemini CLI transcript evidence.',
    ],
  };
}

async function collectGeminiProjectRootFiles() {
  const candidates = [
    ...(await listFiles(path.join(geminiRoot, 'history'), (filePath) => path.basename(filePath) === '.project_root')),
    ...(await listFiles(path.join(geminiRoot, 'tmp'), (filePath) => path.basename(filePath) === '.project_root')),
  ];
  return [...new Set(candidates)].sort();
}

async function collectGeminiChatFiles() {
  return listFiles(
    path.join(geminiRoot, 'tmp'),
    (filePath) =>
      filePath.endsWith('.json') && path.basename(path.dirname(filePath)) === 'chats' && filePath.includes(`${path.sep}tmp${path.sep}`),
  );
}

async function collectCursorChatStore(filesRoot, copiedAcrossPlatforms) {
  const storeFiles = await listFiles(
    cursorChatStoreRoot,
    (filePath) => path.basename(filePath) === 'store.db' && filePath.includes(`${path.sep}.cursor${path.sep}chats${path.sep}`),
  );
  const copiedFiles = new Set();

  for (const filePath of storeFiles) {
    const relativePath = await copyHomeRelativePath(filePath, filesRoot, copiedAcrossPlatforms);
    if (relativePath) {
      copiedFiles.add(relativePath);
    }
  }

  return {
    checked_roots: [
      {
        kind: 'cursor_chat_store_root',
        path: cursorChatStoreRoot,
        exists: await pathExists(cursorChatStoreRoot),
      },
    ],
    exists: copiedFiles.size > 0,
    copied_files: [...copiedFiles].sort(),
    notes: [
      'Collect only ~/.cursor/chats/**/store.db for this slot; intentionally ignore stable Cursor editor-state roots such as ~/.cursor/projects and Cursor workspaceStorage because they are a different source slice.',
    ],
  };
}

async function collectCodeBuddy(filesRoot, copiedAcrossPlatforms) {
  const topLevelCandidates = [
    path.join(codebuddyRoot, 'settings.json'),
  ];
  const localStorageFiles = await listFiles(
    path.join(codebuddyRoot, 'local_storage'),
    (filePath) => filePath.endsWith('.info'),
  );
  const projectFiles = await listFiles(
    path.join(codebuddyRoot, 'projects'),
    (filePath) => filePath.endsWith('.jsonl'),
  );
  const copiedFiles = new Set();

  for (const candidate of [...topLevelCandidates, ...localStorageFiles, ...projectFiles]) {
    const relativePath = await copyHomeRelativePath(candidate, filesRoot, copiedAcrossPlatforms);
    if (relativePath) {
      copiedFiles.add(relativePath);
    }
  }

  return {
    checked_roots: [
      {
        kind: 'codebuddy_root',
        path: codebuddyRoot,
        exists: await pathExists(codebuddyRoot),
      },
      {
        kind: 'project_transcripts',
        path: path.join(codebuddyRoot, 'projects'),
        exists: await pathExists(path.join(codebuddyRoot, 'projects')),
      },
      {
        kind: 'local_storage',
        path: path.join(codebuddyRoot, 'local_storage'),
        exists: await pathExists(path.join(codebuddyRoot, 'local_storage')),
      },
    ],
    exists: copiedFiles.size > 0,
    copied_files: [...copiedFiles].sort(),
    notes: [
      'Collect non-empty and zero-byte .codebuddy/projects/**/*.jsonl files plus companion settings/local_storage evidence; do not infer that every copied JSONL already represents a validated standalone session.',
    ],
  };
}

async function copyHomeRelativePath(sourcePath, filesRoot, copiedAcrossPlatforms) {
  try {
    const relativePath = path.relative(homeDir, sourcePath);
    if (relativePath.startsWith('..')) {
      return null;
    }
    if (!copiedAcrossPlatforms.has(relativePath)) {
      const destination = path.join(filesRoot, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(sourcePath, destination, { force: true });
      copiedAcrossPlatforms.add(relativePath);
    }
    return relativePath;
  } catch {
    return null;
  }
}

async function readOpenCodeSessionId(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    if (parsed && typeof parsed === 'object') {
      return parsed.id ?? parsed.sessionId ?? parsed.session_id ?? path.basename(filePath, path.extname(filePath));
    }
  } catch {
    return path.basename(filePath, path.extname(filePath));
  }
  return path.basename(filePath, path.extname(filePath));
}

async function listFiles(rootDir, matcher) {
  try {
    const entries = await readdir(rootDir, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const targetPath = path.join(rootDir, entry.name);
        if (entry.isDirectory()) {
          return listFiles(targetPath, matcher);
        }
        return matcher(targetPath) ? [targetPath] : [];
      }),
    );
    return nested.flat();
  } catch {
    return [];
  }
}

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function uniqueStrings(values) {
  return [...new Set(values)];
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
