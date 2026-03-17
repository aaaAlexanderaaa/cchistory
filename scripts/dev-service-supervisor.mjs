#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  requireServiceName,
  serviceChildPidFile,
  serviceChildLogFile,
  serviceSupervisorPidFile,
  serviceLaunchCommand,
  serviceLaunchEnv,
  servicePrepare,
  stopServiceRuntime,
  stopPidTree,
  cleanupStalePidFile,
  writePidFile,
  waitForServiceListener,
  serviceWaitMode,
  restartDelaySeconds,
  isPidAlive,
  timestamp,
  sleep,
} from "./dev-service-lib.mjs";

const service = process.argv[2];
requireServiceName(service);

const SUPERVISOR_PID_FILE = serviceSupervisorPidFile(service);
const CHILD_PID_FILE = serviceChildPidFile(service);

let stopRequested = false;
let childPid = null;

function log(msg) {
  const line = `[${timestamp()}] [${service}] ${msg}\n`;
  process.stdout.write(line);
}

function handleStop() {
  stopRequested = true;
  if (childPid != null) {
    stopPidTree(childPid);
  }
}

function cleanup() {
  try { fs.unlinkSync(SUPERVISOR_PID_FILE); } catch { /* ignore */ }
  cleanupStalePidFile(CHILD_PID_FILE);
}

process.on("SIGTERM", handleStop);
process.on("SIGINT", handleStop);
process.on("exit", cleanup);

writePidFile(SUPERVISOR_PID_FILE, process.pid);
cleanupStalePidFile(CHILD_PID_FILE);

let restartAttempt = 0;

while (!stopRequested) {
  if (!servicePrepare(service)) {
    const delay = restartDelaySeconds(restartAttempt);
    log(`preflight failed, retrying in ${delay}s`);
    await sleep(delay * 1000);
    restartAttempt++;
    continue;
  }

  stopServiceRuntime(service);
  writePidFile(SUPERVISOR_PID_FILE, process.pid);

  const childLogFile = serviceChildLogFile(service);
  fs.mkdirSync(path.dirname(childLogFile), { recursive: true });
  fs.appendFileSync(childLogFile, `\n[${timestamp()}] launching ${service}\n`);

  const logFd = fs.openSync(childLogFile, "a");
  const { cmd, args, cwd } = serviceLaunchCommand(service);
  const launchEnv = { ...process.env, ...serviceLaunchEnv(service) };

  const child = spawn(cmd, args, {
    cwd,
    env: launchEnv,
    stdio: ["ignore", logFd, logFd],
    detached: false,
    shell: false,
  });

  const launcherPid = child.pid;
  const waitMode = serviceWaitMode(service);

  const listenerPid = await waitForServiceListener(service, launcherPid);

  if (waitMode === "listener" && listenerPid != null) {
    childPid = listenerPid;
  } else {
    childPid = launcherPid;
  }

  writePidFile(CHILD_PID_FILE, childPid);
  const startedAt = Date.now();
  log(`started child pid ${childPid} (${waitMode})`);

  if (waitMode === "poll") {
    while (isPidAlive(childPid) && !stopRequested) {
      await sleep(1000);
    }
  } else {
    const exitCode = await new Promise((resolve) => {
      child.on("exit", (code) => resolve(code ?? 1));
      child.on("error", () => resolve(1));
    });
    void exitCode;
  }

  try { fs.closeSync(logFd); } catch { /* ignore */ }
  try { fs.unlinkSync(CHILD_PID_FILE); } catch { /* ignore */ }

  if (stopRequested) {
    log("stopped");
    break;
  }

  const runtimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
  if (runtimeSeconds >= 60) {
    restartAttempt = 0;
  } else {
    restartAttempt++;
  }

  const delay = restartDelaySeconds(restartAttempt);
  log(`child exited after ${runtimeSeconds}s, restarting in ${delay}s`);
  await sleep(delay * 1000);
}
