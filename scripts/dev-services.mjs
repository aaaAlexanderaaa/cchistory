#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  requireServiceName,
  serviceTargets,
  serviceSupervisorPidFile,
  serviceSupervisorLogFile,
  serviceChildPidFile,
  serviceChildLogFile,
  servicePort,
  serviceLaunchCommand,
  serviceLaunchEnv,
  servicePrepare,
  readPidFile,
  isPidAlive,
  cleanupStalePidFile,
  portListenerPids,
  fileHolderPids,
  stopServiceProcesses,
  waitForServiceReady,
  showPortStatus,
  IS_WIN,
  ROOT_DIR,
  timestamp,
} from "./dev-service-lib.mjs";

const __filename = fileURLToPath(import.meta.url);
const SUPERVISOR_SCRIPT = path.join(path.dirname(__filename), "dev-service-supervisor.mjs");

const ACTION = process.argv[2] || "status";
const TARGET = process.argv[3] || "all";

function usage() {
  console.log(`Usage:
  node scripts/dev-services.mjs <start|stop|restart|run|status> [web|api|all]

  run   - run a single service in the foreground (no daemon, no auto-restart)`);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function startService(service) {
  requireServiceName(service);

  const supervisorPidFile = serviceSupervisorPidFile(service);
  const supervisorLogFile = serviceSupervisorLogFile(service);

  cleanupStalePidFile(supervisorPidFile);
  const existingPid = readPidFile(supervisorPidFile);
  const listenerPids = portListenerPids(service);

  if (isPidAlive(existingPid)) {
    console.log(`${service}: already running (supervisor ${existingPid})`);
    return;
  }

  if (listenerPids.length > 0) {
    console.log(`${service}: already running (unmanaged listener ${listenerPids.join(" ")})`);
    return;
  }

  fs.mkdirSync(path.dirname(supervisorLogFile), { recursive: true });
  fs.appendFileSync(
    supervisorLogFile,
    `\n[${timestamp()}] starting ${service} supervisor\n`,
  );

  const logFd = fs.openSync(supervisorLogFile, "a");

  const child = spawn(process.execPath, [SUPERVISOR_SCRIPT, service], {
    cwd: ROOT_DIR,
    stdio: ["ignore", logFd, logFd],
    detached: true,
    shell: false,
  });
  child.unref();
  try { fs.closeSync(logFd); } catch { /* ignore */ }

  if (await waitForServiceReady(service, 120)) {
    const supervisorPid = readPidFile(supervisorPidFile);
    console.log(`${service}: started supervisor ${supervisorPid}`);
    return;
  }

  const supervisorPid = readPidFile(supervisorPidFile);
  if (isPidAlive(supervisorPid)) {
    console.error(`${service}: supervisor started but service did not become ready in time`);
    process.exitCode = 1;
    return;
  }

  console.error(`${service}: failed to start supervisor`);
  process.exitCode = 1;
}

function stopService(service) {
  requireServiceName(service);
  stopServiceProcesses(service);
  console.log(`${service}: stopped`);
}

async function restartService(service) {
  stopService(service);
  await startService(service);
}

function runService(service) {
  requireServiceName(service);
  stopServiceProcesses(service);

  console.log(`[run] preparing ${service}...`);
  if (!servicePrepare(service)) {
    console.error(`[run] ${service}: prepare failed`);
    process.exit(1);
  }

  const { cmd, args, cwd } = serviceLaunchCommand(service);
  const launchEnv = { ...process.env, ...serviceLaunchEnv(service) };

  console.log(`[run] ${service}: starting in foreground (no auto-restart)`);
  console.log(`[run] command: ${cmd} ${args.join(" ")}`);
  console.log("---");

  const child = spawn(cmd, args, {
    cwd,
    env: launchEnv,
    stdio: "inherit",
    shell: false,
  });

  child.on("exit", (code) => process.exit(code ?? 1));
}

function statusService(service) {
  requireServiceName(service);

  const supervisorPidFile = serviceSupervisorPidFile(service);
  const childPidFile = serviceChildPidFile(service);
  cleanupStalePidFile(supervisorPidFile);
  cleanupStalePidFile(childPidFile);

  const supervisorPid = readPidFile(supervisorPidFile);
  const childPid = readPidFile(childPidFile);
  const port = servicePort(service);
  const logFile = serviceChildLogFile(service);
  const supLogFile = serviceSupervisorLogFile(service);
  const listenerPids = portListenerPids(service);
  const supervisorHolders = fileHolderPids(supLogFile);

  let state;
  if (isPidAlive(supervisorPid) || supervisorHolders.length > 0) {
    state = "running (managed)";
  } else if (isPidAlive(childPid) || listenerPids.length > 0) {
    state = "running (unmanaged)";
  } else {
    state = "stopped";
  }

  console.log(`${service}: ${state}`);
  console.log(`  supervisor pid: ${supervisorPid ?? "none"}`);
  console.log(`  supervisor log holder pid(s): ${supervisorHolders.join(" ") || "none"}`);
  console.log(`  child pid: ${childPid ?? "none"}`);
  console.log(`  port listener pid(s): ${listenerPids.join(" ") || "none"}`);
  console.log(`  port: ${port}`);
  console.log(`  app log: ${logFile}`);
  console.log(`  supervisor log: ${supLogFile}`);

  showPortStatus(service);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

switch (ACTION) {
  case "start":
    for (const s of serviceTargets(TARGET)) await startService(s);
    break;
  case "stop":
    for (const s of serviceTargets(TARGET)) stopService(s);
    break;
  case "restart":
    for (const s of serviceTargets(TARGET)) await restartService(s);
    break;
  case "run":
    runService(TARGET);
    break;
  case "status":
    for (const s of serviceTargets(TARGET)) statusService(s);
    break;
  default:
    usage();
    process.exit(1);
}
