import { execFileSync, execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
export const ROOT_DIR = path.resolve(path.dirname(__filename), "..");
export const DEV_SERVICE_DIR = path.join(ROOT_DIR, ".dev-services");
export const IS_WIN = process.platform === "win32";
const PNPM_BIN = process.env.PNPM_BIN || findBin("pnpm");

fs.mkdirSync(DEV_SERVICE_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Service metadata
// ---------------------------------------------------------------------------

const VALID_SERVICES = ["web", "api"];

export function requireServiceName(service) {
  if (!VALID_SERVICES.includes(service)) {
    console.error(`Unsupported service: ${service}`);
    process.exit(1);
  }
}

export function servicePort(service) {
  return service === "web" ? 8085 : Number(process.env.PORT) || 8040;
}

export function serviceWaitMode(service) {
  return service === "web" ? "listener" : "process";
}

export function serviceChildPidFile(service) {
  return path.join(DEV_SERVICE_DIR, `${service}.pid`);
}

export function serviceChildLogFile(service) {
  return path.join(DEV_SERVICE_DIR, `${service}.log`);
}

export function serviceTempDir(service) {
  return path.join(DEV_SERVICE_DIR, "tmp", service);
}

export function serviceSupervisorPidFile(service) {
  return path.join(DEV_SERVICE_DIR, `${service}-supervisor.pid`);
}

export function serviceSupervisorLogFile(service) {
  return path.join(DEV_SERVICE_DIR, `${service}-supervisor.log`);
}

// ---------------------------------------------------------------------------
// PID file helpers
// ---------------------------------------------------------------------------

export function readPidFile(pidFile) {
  try {
    const content = fs.readFileSync(pidFile, "utf8").trim();
    return content ? Number(content) : null;
  } catch {
    return null;
  }
}

export function writePidFile(pidFile, pid) {
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(pidFile, String(pid), "utf8");
}

export function isPidAlive(pid) {
  if (pid == null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function cleanupStalePidFile(pidFile) {
  const pid = readPidFile(pidFile);
  if (pid != null && !isPidAlive(pid)) {
    try { fs.unlinkSync(pidFile); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Port listener detection (cross-platform)
// ---------------------------------------------------------------------------

export function portListenerPids(service) {
  const port = servicePort(service);
  if (IS_WIN) {
    return portListenerPidsWindows(port);
  }
  return portListenerPidsUnix(port);
}

function portListenerPidsUnix(port) {
  let output = "";
  try {
    output = execFileSync("lsof", ["-tiTCP:" + port, "-sTCP:LISTEN"], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch { /* lsof not found or no results */ }
  if (!output.trim()) {
    try {
      output = execFileSync("fuser", [port + "/tcp"], {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch { /* fuser not found or no results */ }
  }
  return parsePidList(output);
}

function portListenerPidsWindows(port) {
  let output = "";
  try {
    output = execSync(
      `netstat -ano | findstr LISTENING | findstr :${port}`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
  } catch { return []; }
  const pids = new Set();
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    const pid = Number(parts[parts.length - 1]);
    if (pid > 0) pids.add(pid);
  }
  return [...pids];
}

// ---------------------------------------------------------------------------
// File holder detection
// ---------------------------------------------------------------------------

export function fileHolderPids(targetFile) {
  if (!fs.existsSync(targetFile)) return [];
  if (IS_WIN) return [];
  try {
    const output = execFileSync("lsof", ["-t", targetFile], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return parsePidList(output);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Process tree management (cross-platform)
// ---------------------------------------------------------------------------

export function collectProcessTree(pid) {
  if (pid == null || !Number.isFinite(pid)) return [];
  const collected = [];
  collectProcessTreeRecursive(pid, collected);
  return collected;
}

function collectProcessTreeRecursive(pid, collected) {
  const children = getChildPids(pid);
  for (const child of children) {
    collectProcessTreeRecursive(child, collected);
  }
  collected.push(pid);
}

function getChildPids(pid) {
  if (IS_WIN) {
    try {
      const output = execSync(
        `wmic process where (ParentProcessId=${pid}) get ProcessId /format:list`,
        { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
      );
      return parsePidList(output.replace(/ProcessId=/g, ""));
    } catch {
      return [];
    }
  }
  try {
    const output = execFileSync("pgrep", ["-P", String(pid)], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return parsePidList(output);
  } catch {
    return [];
  }
}

export function stopPidTree(pid) {
  if (!isPidAlive(pid)) return;
  const targets = collectProcessTree(pid);

  if (IS_WIN) {
    try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: "pipe" }); } catch { /* ignore */ }
    sleepMs(300);
    return;
  }

  for (const t of targets) {
    try { process.kill(t, "SIGTERM"); } catch { /* ignore */ }
  }

  let waited = 0;
  while (isPidAlive(pid) && waited < 3000) {
    sleepMs(200);
    waited += 200;
  }

  if (isPidAlive(pid)) {
    for (const t of targets) {
      try { process.kill(t, "SIGKILL"); } catch { /* ignore */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Stop service helpers
// ---------------------------------------------------------------------------

export function stopServiceRuntime(service) {
  const childPidFile = serviceChildPidFile(service);
  cleanupStalePidFile(childPidFile);
  const childPid = readPidFile(childPidFile);

  if (childPid != null) {
    stopPidTree(childPid);
    try { fs.unlinkSync(childPidFile); } catch { /* ignore */ }
  }

  for (const portPid of portListenerPids(service)) {
    stopPidTree(portPid);
  }

  const runtimeLogFile = serviceChildLogFile(service);
  for (const holderPid of fileHolderPids(runtimeLogFile)) {
    stopPidTree(holderPid);
  }
}

export function stopServiceProcesses(service) {
  const supervisorPidFile = serviceSupervisorPidFile(service);
  const supervisorLogFile = serviceSupervisorLogFile(service);

  cleanupStalePidFile(supervisorPidFile);
  const supervisorPid = readPidFile(supervisorPidFile);

  if (supervisorPid != null) {
    stopPidTree(supervisorPid);
    try { fs.unlinkSync(supervisorPidFile); } catch { /* ignore */ }
  }

  for (const holderPid of fileHolderPids(supervisorLogFile)) {
    stopPidTree(holderPid);
  }

  stopServiceRuntime(service);
}

// ---------------------------------------------------------------------------
// Service prepare (build dependencies)
// ---------------------------------------------------------------------------

export function servicePrepare(service) {
  const tmpDir = serviceTempDir(service);
  fs.mkdirSync(tmpDir, { recursive: true });

  const memMb = process.env.SERVICE_PREPARE_NODE_MEMORY_MB || "512";
  const nodeOptions = appendNodeOption(process.env.NODE_OPTIONS, `--max-old-space-size=${memMb}`);

  if (service === "web") {
    if (!PNPM_BIN) {
      console.error("pnpm not found in PATH");
      return false;
    }
    return runSync(PNPM_BIN, ["--filter", "@cchistory/api-client", "build"], { nodeOptions });
  }

  if (service === "api") {
    const tscBin = findProjectBin("tsc");
    return (
      runSync(tscBin, ["-p", path.join(ROOT_DIR, "packages/domain/tsconfig.json")], { nodeOptions }) &&
      runSync(tscBin, ["-p", path.join(ROOT_DIR, "packages/source-adapters/tsconfig.json")], { nodeOptions }) &&
      runSync(tscBin, ["-p", path.join(ROOT_DIR, "packages/storage/tsconfig.json")], { nodeOptions })
    );
  }

  return true;
}

// ---------------------------------------------------------------------------
// Service launch command construction
// ---------------------------------------------------------------------------

export function serviceLaunchEnv(service) {
  const tmpDir = serviceTempDir(service);
  const base = { TMPDIR: tmpDir, TMP: tmpDir, TEMP: tmpDir };

  if (service === "web") {
    const memMb = process.env.NODE_MEMORY_MB || "640";
    return {
      ...base,
      NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS, `--max-old-space-size=${memMb}`),
    };
  }

  if (service === "api") {
    const memMb = process.env.API_NODE_MEMORY_MB || "256";
    return {
      ...base,
      PORT: String(process.env.PORT || "8040"),
      NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS, `--max-old-space-size=${memMb}`),
    };
  }

  return base;
}

export function serviceLaunchCommand(service) {
  if (service === "web") {
    const webDir = path.join(ROOT_DIR, "apps/web");
    const nextBin = path.join(webDir, "node_modules/.bin/next");
    return {
      cmd: IS_WIN ? "cmd" : nextBin,
      args: IS_WIN
        ? ["/c", nextBin.replace(/\//g, "\\"), "dev", "--webpack", "--hostname", "0.0.0.0", "--port", "8085"]
        : ["dev", "--webpack", "--hostname", "0.0.0.0", "--port", "8085"],
      cwd: webDir,
    };
  }

  if (service === "api") {
    const apiDir = path.join(ROOT_DIR, "apps/api");
    const tsxBin = path.join(apiDir, "node_modules/.bin/tsx");
    return {
      cmd: IS_WIN ? "cmd" : tsxBin,
      args: IS_WIN
        ? ["/c", tsxBin.replace(/\//g, "\\"), "watch", "src/index.ts"]
        : ["watch", "src/index.ts"],
      cwd: apiDir,
    };
  }

  throw new Error(`Unknown service: ${service}`);
}

// ---------------------------------------------------------------------------
// Readiness checks
// ---------------------------------------------------------------------------

export async function waitForServiceReady(service, maxAttempts = 120) {
  const supervisorPidFile = serviceSupervisorPidFile(service);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    cleanupStalePidFile(supervisorPidFile);
    const supervisorPid = readPidFile(supervisorPidFile);

    if (supervisorPid == null) {
      await sleep(500);
      continue;
    }
    if (!isPidAlive(supervisorPid)) return false;

    const listeners = portListenerPids(service);
    if (listeners.length > 0) return true;

    await sleep(500);
  }

  return false;
}

export async function waitForServiceListener(service, launcherPid) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const listeners = portListenerPids(service);
    if (listeners.length > 0) return listeners[0];
    if (!isPidAlive(launcherPid)) break;
    await sleep(500);
  }
  return null;
}

export function restartDelaySeconds(attempt) {
  if (attempt <= 0) return 2;
  if (attempt === 1) return 4;
  if (attempt === 2) return 8;
  if (attempt === 3) return 12;
  return 20;
}

// ---------------------------------------------------------------------------
// Service targets
// ---------------------------------------------------------------------------

export function serviceTargets(target) {
  if (target === "all") return ["api", "web"];
  if (VALID_SERVICES.includes(target)) return [target];
  console.error(`Unknown target: ${target}. Use web, api, or all.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// lsof status display (optional, non-critical)
// ---------------------------------------------------------------------------

export function showPortStatus(service) {
  const port = servicePort(service);
  if (IS_WIN) {
    try {
      const output = execSync(`netstat -ano | findstr LISTENING | findstr :${port}`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      if (output.trim()) console.log(output.trim());
    } catch { /* no listeners */ }
    return;
  }
  try {
    const output = execFileSync("lsof", ["-iTCP:" + port, "-sTCP:LISTEN", "-n", "-P"], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (output.trim()) console.log(output.trim());
  } catch { /* lsof not available or no listeners */ }
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function parsePidList(output) {
  if (!output) return [];
  return [...new Set(
    output
      .split(/[\s\r\n]+/)
      .map((s) => Number(s.trim()))
      .filter((n) => n > 0 && Number.isFinite(n)),
  )];
}

function appendNodeOption(existing, option) {
  const base = (existing || "").trim();
  return base ? `${base} ${option}` : option;
}

function findBin(name) {
  try {
    const cmd = IS_WIN ? "where" : "which";
    return execFileSync(cmd, [name], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim().split(/\r?\n/)[0];
  } catch {
    return null;
  }
}

function findProjectBin(name) {
  const local = path.join(ROOT_DIR, "node_modules/.bin", name);
  if (fs.existsSync(local)) return local;
  if (IS_WIN && fs.existsSync(local + ".cmd")) return local + ".cmd";
  return findBin(name) || name;
}

function runSync(cmd, args, opts = {}) {
  const env = { ...process.env };
  if (opts.nodeOptions) env.NODE_OPTIONS = opts.nodeOptions;
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd || ROOT_DIR,
    env,
    stdio: "inherit",
    shell: IS_WIN,
  });
  return result.status === 0;
}

export function sleepMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* busy wait for sync contexts */ }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function timestamp() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}
