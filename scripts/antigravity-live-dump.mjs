#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { request as httpsRequest } from "node:https";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const API_SERVICE = "exa.language_server_pb.LanguageServerService";
const DEFAULT_APP_DATA_DIR = "antigravity";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = path.resolve(args.outDir ?? defaultOutputDir());

  const live = await discoverLiveEndpoint();
  const visibleSummariesPayload = await callLanguageServer(live, "GetAllCascadeTrajectories", {});
  const visibleSummaries = visibleSummariesPayload.trajectorySummaries ?? {};
  const pbIds = await listConversationPbIds();
  const cascadeIds = uniqueStrings([...Object.keys(visibleSummaries), ...pbIds]).sort();

  await mkdir(outputDir, { recursive: true });
  await mkdir(path.join(outputDir, "trajectories"), { recursive: true });

  const aggregateUserInputs = [];
  const failures = [];

  for (const cascadeId of cascadeIds) {
    try {
      const stepsPayload = await callLanguageServer(live, "GetCascadeTrajectorySteps", { cascadeId });
      const steps = Array.isArray(stepsPayload.steps) ? stepsPayload.steps : [];
      const trajectoryDump = buildTrajectoryDump({
        cascadeId,
        steps,
        pbOnDisk: pbIds.includes(cascadeId),
        visibleSummary: visibleSummaries[cascadeId],
      });

      aggregateUserInputs.push(...trajectoryDump.userInputs);
      await writeFile(
        path.join(outputDir, "trajectories", `${cascadeId}.json`),
        `${JSON.stringify(trajectoryDump, null, 2)}\n`,
        "utf8",
      );
    } catch (error) {
      failures.push({
        cascadeId,
        error: formatError(error),
      });
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    assumptions: [
      "Uses the running Antigravity language server rather than offline .pb decryption.",
      "Fetches visible trajectory summaries from GetAllCascadeTrajectories.",
      "Augments the visible index with every .pb filename under ~/.gemini/antigravity/conversations.",
      "Fetches trajectory steps by cascadeId via GetCascadeTrajectorySteps.",
      "Treats userInput.userResponse as the canonical user-turn text source.",
      "Treats empty USER_INPUT steps with only artifactComments as non-text interactions.",
    ],
    connection: {
      pid: live.pid,
      command: live.command,
      csrfToken: live.csrfToken,
      extensionServerPort: live.extensionServerPort,
      apiPort: live.apiPort,
      candidatePorts: live.candidatePorts,
    },
    counts: {
      visibleIndexedTrajectories: Object.keys(visibleSummaries).length,
      pbFilesOnDisk: pbIds.length,
      attemptedTrajectories: cascadeIds.length,
      dumpedTrajectories: cascadeIds.length - failures.length,
      failedTrajectories: failures.length,
      extractedUserInputs: aggregateUserInputs.length,
    },
    failures,
  };

  await writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(path.join(outputDir, "summaries.json"), `${JSON.stringify(visibleSummaries, null, 2)}\n`, "utf8");
  await writeFile(path.join(outputDir, "user-inputs.json"), `${JSON.stringify(aggregateUserInputs, null, 2)}\n`, "utf8");

  process.stdout.write(`${JSON.stringify({ outputDir, manifest }, null, 2)}\n`);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out-dir" && argv[index + 1]) {
      parsed.outDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--out-dir=")) {
      parsed.outDir = arg.slice("--out-dir=".length);
    }
  }
  return parsed;
}

function defaultOutputDir() {
  const stamp = new Date().toISOString().replaceAll(":", "-");
  return path.join(process.cwd(), ".cchistory", "inspections", `antigravity-live-${stamp}`);
}

async function discoverLiveEndpoint() {
  const processes = await listLanguageServerProcesses();
  const failures = [];

  for (const candidate of processes) {
    const candidatePorts = await buildCandidatePorts(candidate);
    for (const apiPort of candidatePorts) {
      try {
        await callLanguageServer({ ...candidate, apiPort, candidatePorts }, "GetUserStatus", {});
        return { ...candidate, apiPort, candidatePorts };
      } catch (error) {
        failures.push({
          pid: candidate.pid,
          apiPort,
          error: formatError(error),
        });
      }
    }
  }

  throw new Error(`Failed to discover a live Antigravity API endpoint: ${JSON.stringify(failures, null, 2)}`);
}

async function listLanguageServerProcesses() {
  const { stdout } = await execFile("ps", ["axww", "-o", "pid=,command="], {
    maxBuffer: 10 * 1024 * 1024,
  });

  const matches = [];
  for (const rawLine of stdout.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line.includes("language_server_macos_arm")) {
      continue;
    }
    if (!line.includes(`--app_data_dir ${DEFAULT_APP_DATA_DIR}`)) {
      continue;
    }

    const match = line.match(/^(\d+)\s+(.*)$/u);
    if (!match) {
      continue;
    }

    const pid = Number.parseInt(match[1], 10);
    const command = match[2] ?? "";
    const csrfToken = extractFlagValue(command, "--csrf_token");
    const extensionServerPortText = extractFlagValue(command, "--extension_server_port");
    const extensionServerPort = extensionServerPortText ? Number.parseInt(extensionServerPortText, 10) : undefined;

    if (!Number.isFinite(pid) || !csrfToken || !Number.isFinite(extensionServerPort)) {
      continue;
    }

    matches.push({
      pid,
      command,
      csrfToken,
      extensionServerPort,
    });
  }

  if (matches.length === 0) {
    throw new Error("No running Antigravity language_server_macos_arm process was found.");
  }

  return matches;
}

function extractFlagValue(command, flagName) {
  const parts = command.split(/\s+/u);
  const index = parts.findIndex((part) => part === flagName);
  if (index === -1) {
    return undefined;
  }
  return parts[index + 1];
}

async function buildCandidatePorts(candidate) {
  const ports = [candidate.extensionServerPort + 1];
  try {
    const { stdout } = await execFile("lsof", ["-Pan", "-p", String(candidate.pid), "-iTCP", "-sTCP:LISTEN"], {
      maxBuffer: 1024 * 1024,
    });
    for (const rawLine of stdout.split(/\r?\n/u)) {
      const match = rawLine.match(/127\.0\.0\.1:(\d+)\s+\(LISTEN\)/u);
      if (!match) {
        continue;
      }
      const port = Number.parseInt(match[1], 10);
      if (Number.isFinite(port)) {
        ports.push(port);
      }
    }
  } catch {
    // The +1 heuristic is usually enough. Keep going if lsof is unavailable.
  }
  return uniqueNumbers(ports);
}

async function callLanguageServer(live, method, body) {
  const url = `https://127.0.0.1:${live.apiPort}/${API_SERVICE}/${method}`;
  return postJson(url, {
    "Content-Type": "application/json",
    "x-codeium-csrf-token": live.csrfToken,
  }, body);
}

function postJson(url, headers, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = httpsRequest(url, {
      method: "POST",
      rejectUnauthorized: false,
      headers: {
        ...headers,
        "Content-Length": Buffer.byteLength(payload),
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if ((response.statusCode ?? 0) >= 400) {
          reject(new Error(`HTTP ${response.statusCode}: ${text}`));
          return;
        }
        try {
          resolve(text ? JSON.parse(text) : {});
        } catch (error) {
          reject(new Error(`Invalid JSON response from ${url}: ${formatError(error)} ${text.slice(0, 400)}`));
        }
      });
    });
    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

async function listConversationPbIds() {
  const conversationDir = path.join(homedir(), ".gemini", "antigravity", "conversations");
  try {
    const entries = await readdir(conversationDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".pb"))
      .map((entry) => entry.name.slice(0, -".pb".length))
      .sort();
  } catch {
    return [];
  }
}

function buildTrajectoryDump(input) {
  const { cascadeId, steps, pbOnDisk, visibleSummary } = input;
  const userInputs = [];

  for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
    const step = steps[stepIndex];
    if (step?.type !== "CORTEX_STEP_TYPE_USER_INPUT") {
      continue;
    }
    userInputs.push(buildUserInputRecord({ cascadeId, visibleSummary, stepIndex, step }));
  }

  return {
    cascadeId,
    pbOnDisk,
    visibleInCurrentIndex: Boolean(visibleSummary),
    summary: visibleSummary ?? null,
    createdAt: steps[0]?.metadata?.createdAt ?? visibleSummary?.createdTime ?? null,
    updatedAt: steps[steps.length - 1]?.metadata?.createdAt ?? visibleSummary?.lastModifiedTime ?? null,
    stepCount: steps.length,
    userInputs,
    steps,
  };
}

function buildUserInputRecord(input) {
  const { cascadeId, visibleSummary, stepIndex, step } = input;
  const ui = step?.userInput ?? {};
  const responseText = typeof ui.userResponse === "string" ? ui.userResponse.trim() : "";
  const text = responseText;
  const artifactCommentCount = Array.isArray(ui.artifactComments) ? ui.artifactComments.length : 0;

  let kind = "empty";
  if (text) {
    kind = "text";
  } else if (artifactCommentCount > 0) {
    kind = "artifact_comment_only";
  }

  return {
    cascadeId,
    summary: visibleSummary?.summary ?? null,
    stepIndex,
    createdAt: step?.metadata?.createdAt ?? null,
    kind,
    text,
    artifactCommentCount,
  };
}

function uniqueNumbers(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    if (!Number.isFinite(value) || seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }
  return out;
}

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }
  return out;
}

function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

main().catch((error) => {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
});
