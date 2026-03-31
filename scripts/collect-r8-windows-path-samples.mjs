import { access, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

async function pathExists(targetPath) {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

function candidateMatrix(homeDir, appDataDir, localAppDataDir) {
  return {
    codex: [path.join(homeDir, '.codex', 'sessions')],
    claude_code: [path.join(homeDir, '.claude', 'projects')],
    factory_droid: [path.join(homeDir, '.factory', 'sessions')],
    amp: [
      path.join(homeDir, '.local', 'share', 'amp', 'threads'),
      path.join(localAppDataDir, 'amp', 'threads'),
    ],
    cursor: [
      path.join(homeDir, '.cursor', 'projects'),
      path.join(appDataDir, 'Cursor', 'User'),
      path.join(appDataDir, 'Cursor'),
    ],
    antigravity: [
      path.join(appDataDir, 'Antigravity', 'User'),
      path.join(appDataDir, 'Antigravity'),
      path.join(homeDir, '.gemini', 'antigravity', 'brain'),
      path.join(homeDir, '.gemini', 'antigravity'),
    ],
    openclaw: [path.join(homeDir, '.openclaw', 'agents')],
    opencode: [
      path.join(homeDir, '.local', 'share', 'opencode', 'project'),
      path.join(homeDir, '.local', 'share', 'opencode', 'storage', 'session'),
      path.join(localAppDataDir, 'opencode', 'project'),
      path.join(localAppDataDir, 'opencode', 'storage', 'session'),
    ],
    lobechat: [
      path.join(homeDir, '.config', 'lobehub-storage'),
      path.join(appDataDir, 'lobehub-storage'),
    ],
  }
}

async function main() {
  const cwd = process.cwd()
  const outPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(cwd, 'r8-windows-path-samples.json')

  const homeDir = process.env.USERPROFILE || os.homedir()
  const appDataDir = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming')
  const localAppDataDir = process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local')
  const matrix = candidateMatrix(homeDir, appDataDir, localAppDataDir)

  const platforms = {}
  for (const [platform, candidates] of Object.entries(matrix)) {
    platforms[platform] = []
    for (const candidate of candidates) {
      platforms[platform].push({
        path: candidate,
        exists: await pathExists(candidate),
      })
    }
  }

  const payload = {
    collected_at: new Date().toISOString(),
    host: {
      platform: process.platform,
      release: os.release(),
      home_dir: homeDir,
      appdata: appDataDir,
      localappdata: localAppDataDir,
    },
    notes: [
      'This script reports candidate Windows source roots based on current repository assumptions plus Windows-oriented heuristics.',
      'Existing paths are evidence worth reviewing; missing paths are not proof that a platform lacks a Windows install location.',
      'Review the JSON on a machine with real local sources before using it to claim verified Windows support.',
    ],
    platforms,
  }

  await mkdir(path.dirname(outPath), { recursive: true })
  await writeFile(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8')
  process.stdout.write(`Wrote Windows path sample report to ${outPath}\n`)
}

main().catch((error) => {
  process.stderr.write(String(error instanceof Error ? error.stack || error.message : error) + '\n')
  process.exitCode = 1
})
