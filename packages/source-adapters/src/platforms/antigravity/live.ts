import { execFile as execFileCallback } from "node:child_process";
import { readdir } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import path from "node:path";
import { promisify } from "node:util";
import { normalizeLocalPathIdentity } from "@cchistory/domain";
import type { ExtractedSessionSeed } from "../../core/conversation-seeds.js";
import { asString, isObject, truncate } from "../../core/utils.js";
import { resolveAntigravityRoots } from "../antigravity.js";

const execFileAsync = promisify(execFileCallback);
const API_SERVICE = "exa.language_server_pb.LanguageServerService";
const DEFAULT_APP_DATA_DIR = "antigravity";
const TOOL_RESULT_PREVIEW_LIMIT = 8_000;
const TITLE_PREVIEW_LIMIT = 72;

interface AntigravityLiveEndpoint {
  pid: number;
  command: string;
  csrfToken: string;
  extensionServerPort: number;
  apiPort: number;
  candidatePorts: number[];
}

interface AntigravityLiveSummaryWorkspace {
  workspaceFolderAbsoluteUri?: string;
  gitRootAbsoluteUri?: string;
  repository?: {
    computedName?: string;
    gitOriginUrl?: string;
  };
}

interface AntigravityLiveSummary {
  summary?: string;
  createdTime?: string;
  lastModifiedTime?: string;
  workspaces?: AntigravityLiveSummaryWorkspace[];
}

interface AntigravityLiveCollectionHelpers {
  appDataDir?: string;
  limit?: number;
  discoverLiveEndpoint?: (appDataDir: string) => Promise<AntigravityLiveEndpoint | undefined>;
  listConversationPbIds?: (conversationDir: string) => Promise<string[]>;
  callLanguageServer?: (
    live: AntigravityLiveEndpoint,
    method: string,
    body: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  nowIso?: () => string;
}

export interface AntigravityLiveSeedCollection {
  seeds: ExtractedSessionSeed[];
  virtualPaths: string[];
}

export async function extractAntigravityLiveSeeds(
  baseDir: string,
  helpers: AntigravityLiveCollectionHelpers = {},
): Promise<AntigravityLiveSeedCollection | undefined> {
  const roots = resolveAntigravityRoots(baseDir);
  const listConversationPbIds = helpers.listConversationPbIds ?? defaultListConversationPbIds;
  const pbIds = roots.conversationDir ? await listConversationPbIds(roots.conversationDir) : [];

  const discoverLiveEndpoint = helpers.discoverLiveEndpoint ?? defaultDiscoverLiveEndpoint;
  const live = await discoverLiveEndpoint(helpers.appDataDir ?? DEFAULT_APP_DATA_DIR);
  if (!live) {
    return undefined;
  }

  const callLanguageServer = helpers.callLanguageServer ?? defaultCallLanguageServer;
  let summariesPayload: Record<string, unknown>;
  try {
    summariesPayload = await callLanguageServer(live, "GetAllCascadeTrajectories", {});
  } catch {
    return undefined;
  }

  const rawSummaries =
    isObject(summariesPayload.trajectorySummaries) ? summariesPayload.trajectorySummaries : {};
  const summaries = new Map<string, AntigravityLiveSummary>();
  for (const [cascadeId, value] of Object.entries(rawSummaries)) {
    if (isObject(value)) {
      summaries.set(cascadeId, value);
    }
  }

  const limit = typeof helpers.limit === "number" ? Math.max(helpers.limit, 0) : undefined;
  const cascadeIds = uniqueStrings([...summaries.keys(), ...pbIds]).sort();
  const selectedCascadeIds = typeof limit === "number" ? cascadeIds.slice(0, limit) : cascadeIds;
  if (selectedCascadeIds.length === 0) {
    return undefined;
  }
  const seeds: ExtractedSessionSeed[] = [];
  const virtualPaths: string[] = [];
  for (const cascadeId of selectedCascadeIds) {
    let stepsPayload: Record<string, unknown>;
    try {
      stepsPayload = await callLanguageServer(live, "GetCascadeTrajectorySteps", { cascadeId });
    } catch {
      continue;
    }

    const steps = Array.isArray(stepsPayload.steps) ? stepsPayload.steps : [];
    const seed = buildAntigravityLiveSessionSeed({
      cascadeId,
      steps,
      summary: summaries.get(cascadeId),
      nowIso: helpers.nowIso ?? (() => new Date().toISOString()),
    });
    if (!seed) {
      continue;
    }
    seeds.push(seed);
    virtualPaths.push(`antigravity-live://${cascadeId}`);
  }

  if (seeds.length === 0) {
    return undefined;
  }

  return { seeds, virtualPaths };
}

export function buildAntigravityLiveSessionSeed(input: {
  cascadeId: string;
  steps: unknown[];
  summary?: AntigravityLiveSummary;
  nowIso?: () => string;
}): ExtractedSessionSeed | undefined {
  const nowIso = input.nowIso ?? (() => new Date().toISOString());
  const steps = input.steps.filter(isObject);
  const createdAt = asString(input.summary?.createdTime) ?? firstStepTimestamp(steps) ?? nowIso();
  const updatedAt = lastStepTimestamp(steps) ?? asString(input.summary?.lastModifiedTime) ?? createdAt;
  const workingDirectory = deriveWorkspacePath(input.summary, steps);
  const title = deriveSessionTitle(input.cascadeId, input.summary, steps);
  const records: ExtractedSessionSeed["records"] = [
    {
      pointer: "live:trajectory",
      observedAt: createdAt,
      rawJson: JSON.stringify({
        id: `sess:antigravity:${input.cascadeId}`,
        title,
        cwd: workingDirectory,
        createdAt,
        updatedAt,
        antigravityLive: {
          cascadeId: input.cascadeId,
          summary: input.summary ?? null,
          steps,
        },
      }),
    },
  ];

  for (const [stepIndex, step] of steps.entries()) {
    const record = normalizeAntigravityLiveStep({
      cascadeId: input.cascadeId,
      step,
      stepIndex,
      title,
      workingDirectory,
    });
    if (!record) {
      continue;
    }
    records.push(record);
  }

  return {
    sessionId: `sess:antigravity:${input.cascadeId}`,
    title,
    createdAt,
    updatedAt,
    workingDirectory,
    records,
  };
}

function normalizeAntigravityLiveStep(input: {
  cascadeId: string;
  step: Record<string, unknown>;
  stepIndex: number;
  title?: string;
  workingDirectory?: string;
}): ExtractedSessionSeed["records"][number] | undefined {
  const type = asString(input.step.type);
  const observedAt = extractStepTimestamp(input.step);
  if (!type || !observedAt) {
    return undefined;
  }

  if (type === "CORTEX_STEP_TYPE_USER_INPUT") {
    const rawUserInput = isObject(input.step.userInput) ? input.step.userInput : undefined;
    const text = asString(rawUserInput?.userResponse)?.trim();
    if (!text) {
      return undefined;
    }
    return buildLiveMessageRecord(input, observedAt, {
      role: "user",
      content: [{ type: "text", text }],
    });
  }

  if (type === "CORTEX_STEP_TYPE_NOTIFY_USER") {
    const rawNotify = isObject(input.step.notifyUser) ? input.step.notifyUser : undefined;
    const text = asString(rawNotify?.notificationContent)?.trim();
    if (!text) {
      return undefined;
    }
    return buildLiveMessageRecord(input, observedAt, {
      role: "assistant",
      content: [{ type: "text", text }],
    });
  }

  if (type === "CORTEX_STEP_TYPE_PLANNER_RESPONSE") {
    const rawPlanner = isObject(input.step.plannerResponse) ? input.step.plannerResponse : undefined;
    const text = asString(rawPlanner?.modifiedResponse)?.trim();
    if (!text) {
      return undefined;
    }
    return buildLiveMessageRecord(input, observedAt, {
      role: "assistant",
      content: [{ type: "text", text }],
    });
  }

  if (type === "CORTEX_STEP_TYPE_TASK_BOUNDARY") {
    const rawTaskBoundary = isObject(input.step.taskBoundary) ? input.step.taskBoundary : undefined;
    const text = formatTaskBoundaryText(rawTaskBoundary);
    if (!text) {
      return undefined;
    }
    return buildLiveMessageRecord(input, observedAt, {
      role: "system",
      content: [{ type: "text", text }],
    });
  }

  if (type === "CORTEX_STEP_TYPE_ERROR_MESSAGE") {
    const rawErrorMessage = isObject(input.step.errorMessage) ? input.step.errorMessage : undefined;
    const error = isObject(rawErrorMessage?.error) ? rawErrorMessage.error : undefined;
    const text =
      asString(error?.userErrorMessage)?.trim() ??
      asString(error?.shortError)?.trim() ??
      asString(error?.modelErrorMessage)?.trim();
    if (!text) {
      return undefined;
    }
    return buildLiveMessageRecord(input, observedAt, {
      role: "system",
      content: [{ type: "text", text }],
      stopReason: "error",
    });
  }

  const toolCall = extractToolCall(input.step);
  if (!toolCall) {
    return undefined;
  }
  const toolResultText = extractToolResultText(type, input.step);
  return buildLiveMessageRecord(input, observedAt, {
    role: "assistant",
    tool_call: toolCall,
    tool_result: toolResultText
      ? {
          tool_use_id: toolCall.id,
          content: toolResultText,
        }
      : undefined,
  });
}

function buildLiveMessageRecord(
  input: {
    cascadeId: string;
    step: Record<string, unknown>;
    stepIndex: number;
    title?: string;
    workingDirectory?: string;
  },
  observedAt: string,
  message: Record<string, unknown>,
): ExtractedSessionSeed["records"][number] {
  return {
    pointer: `live:steps[${input.stepIndex}]`,
    observedAt,
    rawJson: JSON.stringify({
      timestamp: observedAt,
      title: input.title,
      cwd: input.workingDirectory,
      message,
      antigravityLive: {
        cascadeId: input.cascadeId,
        stepIndex: input.stepIndex,
        stepType: asString(input.step.type),
      },
    }),
  };
}

function formatTaskBoundaryText(taskBoundary: Record<string, unknown> | undefined): string | undefined {
  if (!taskBoundary) {
    return undefined;
  }
  const taskName = asString(taskBoundary.taskName)?.trim();
  const taskStatus = asString(taskBoundary.taskStatus)?.trim();
  const taskSummary = asString(taskBoundary.taskSummary)?.trim();
  const lines = [taskName, taskStatus, taskSummary].filter(
    (value, index, values): value is string => Boolean(value) && values.indexOf(value) === index,
  );
  return lines.length > 0 ? lines.join("\n") : undefined;
}

function extractToolCall(step: Record<string, unknown>): Record<string, unknown> | undefined {
  const metadata = isObject(step.metadata) ? step.metadata : undefined;
  const toolCall = isObject(metadata?.toolCall) ? metadata.toolCall : undefined;
  if (!toolCall) {
    return undefined;
  }
  const id = asString(toolCall?.id);
  const name = asString(toolCall?.name);
  if (!id || !name) {
    return undefined;
  }
  return {
    id,
    name,
    input: parseToolArguments(asString(toolCall.argumentsJson)),
  };
}

function extractToolResultText(type: string, step: Record<string, unknown>): string | undefined {
  if (type === "CORTEX_STEP_TYPE_RUN_COMMAND") {
    const runCommand = isObject(step.runCommand) ? step.runCommand : undefined;
    const combinedOutput = isObject(runCommand?.combinedOutput) ? runCommand.combinedOutput : undefined;
    return truncateToolResult(
      asString(combinedOutput?.full) ??
        asString(combinedOutput?.truncated) ??
        asString(runCommand?.commandLine),
    );
  }
  if (type === "CORTEX_STEP_TYPE_COMMAND_STATUS") {
    const commandStatus = isObject(step.commandStatus) ? step.commandStatus : undefined;
    return truncateToolResult(asString(commandStatus?.combined));
  }
  if (type === "CORTEX_STEP_TYPE_VIEW_FILE") {
    const viewFile = isObject(step.viewFile) ? step.viewFile : undefined;
    return truncateToolResult(asString(viewFile?.content));
  }
  if (type === "CORTEX_STEP_TYPE_VIEW_FILE_OUTLINE") {
    const viewFileOutline = isObject(step.viewFileOutline) ? step.viewFileOutline : undefined;
    return truncateToolResult(JSON.stringify(viewFileOutline ?? {}));
  }
  if (type === "CORTEX_STEP_TYPE_VIEW_CONTENT_CHUNK") {
    const viewContentChunk = isObject(step.viewContentChunk) ? step.viewContentChunk : undefined;
    const croppedItem = isObject(viewContentChunk?.croppedItem) ? viewContentChunk.croppedItem : undefined;
    const chunks = Array.isArray(croppedItem?.chunks) ? croppedItem.chunks : [];
    const text = chunks
      .filter(isObject)
      .map((chunk) => {
        const markdownChunk = isObject(chunk.markdownChunk) ? chunk.markdownChunk : undefined;
        return asString(markdownChunk?.text) ?? "";
      })
      .filter(Boolean)
      .join("\n\n");
    return truncateToolResult(text);
  }
  if (type === "CORTEX_STEP_TYPE_LIST_DIRECTORY") {
    const listDirectory = isObject(step.listDirectory) ? step.listDirectory : undefined;
    const results = Array.isArray(listDirectory?.results) ? listDirectory.results : [];
    const text = results
      .filter(isObject)
      .map((result) => {
        const name = asString(result.name) ?? "";
        const suffix = result.isDir === true ? "/" : "";
        return `${name}${suffix}`;
      })
      .filter(Boolean)
      .join("\n");
    return truncateToolResult(text);
  }
  if (type === "CORTEX_STEP_TYPE_FIND") {
    const find = isObject(step.find) ? step.find : undefined;
    return truncateToolResult(asString(find?.rawOutput) ?? asString(find?.truncatedOutput));
  }
  if (type === "CORTEX_STEP_TYPE_GREP_SEARCH") {
    const grepSearch = isObject(step.grepSearch) ? step.grepSearch : undefined;
    return truncateToolResult(asString(grepSearch?.rawOutput) ?? asString(grepSearch?.truncatedOutput));
  }
  if (type === "CORTEX_STEP_TYPE_SEARCH_WEB") {
    const searchWeb = isObject(step.searchWeb) ? step.searchWeb : undefined;
    return truncateToolResult(asString(searchWeb?.summary));
  }
  if (type === "CORTEX_STEP_TYPE_READ_URL_CONTENT") {
    const readUrlContent = isObject(step.readUrlContent) ? step.readUrlContent : undefined;
    const webDocument = isObject(readUrlContent?.webDocument) ? readUrlContent.webDocument : undefined;
    const chunks = Array.isArray(webDocument?.chunks) ? webDocument.chunks : [];
    const text = chunks
      .filter(isObject)
      .map((chunk) => {
        const markdownChunk = isObject(chunk.markdownChunk) ? chunk.markdownChunk : undefined;
        return asString(markdownChunk?.text) ?? "";
      })
      .filter(Boolean)
      .join("\n\n");
    return truncateToolResult(text);
  }
  if (type === "CORTEX_STEP_TYPE_MCP_TOOL") {
    const mcpTool = isObject(step.mcpTool) ? step.mcpTool : undefined;
    return truncateToolResult(asString(mcpTool?.resultString));
  }
  if (type === "CORTEX_STEP_TYPE_SEND_COMMAND_INPUT") {
    const sendCommandInput = isObject(step.sendCommandInput) ? step.sendCommandInput : undefined;
    return truncateToolResult(asString(sendCommandInput?.input));
  }
  if (type === "CORTEX_STEP_TYPE_LIST_RESOURCES") {
    const listResources = isObject(step.listResources) ? step.listResources : undefined;
    return truncateToolResult(JSON.stringify(listResources ?? {}));
  }
  if (type === "CORTEX_STEP_TYPE_READ_RESOURCE") {
    const readResource = isObject(step.readResource) ? step.readResource : undefined;
    return truncateToolResult(JSON.stringify(readResource ?? {}));
  }
  if (type === "CORTEX_STEP_TYPE_BROWSER_SUBAGENT") {
    const browserSubagent = isObject(step.browserSubagent) ? step.browserSubagent : undefined;
    return truncateToolResult(JSON.stringify(browserSubagent ?? {}));
  }
  if (type === "CORTEX_STEP_TYPE_CODE_ACTION") {
    const codeAction = isObject(step.codeAction) ? step.codeAction : undefined;
    return truncateToolResult(JSON.stringify(codeAction ?? {}));
  }
  return undefined;
}

function parseToolArguments(value: string | undefined): Record<string, unknown> {
  if (!value?.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return isObject(parsed) ? parsed : { raw: value };
  } catch {
    return { raw: value };
  }
}

function deriveSessionTitle(
  cascadeId: string,
  summary: AntigravityLiveSummary | undefined,
  steps: Record<string, unknown>[],
): string | undefined {
  const summaryTitle = asString(summary?.summary)?.trim();
  if (summaryTitle) {
    return summaryTitle;
  }
  for (const step of steps) {
    if (asString(step.type) !== "CORTEX_STEP_TYPE_USER_INPUT") {
      continue;
    }
    const userInput = isObject(step.userInput) ? step.userInput : undefined;
    const text = asString(userInput?.userResponse)?.trim();
    if (text) {
      return truncate(text, TITLE_PREVIEW_LIMIT);
    }
  }
  return cascadeId;
}

function deriveWorkspacePath(
  summary: AntigravityLiveSummary | undefined,
  steps: Record<string, unknown>[],
): string | undefined {
  const workspacePath = normalizeLocalPath(
    asString(summary?.workspaces?.[0]?.workspaceFolderAbsoluteUri),
  );
  if (workspacePath) {
    return workspacePath;
  }

  for (const step of steps) {
    const runCommand = isObject(step.runCommand) ? step.runCommand : undefined;
    const runCommandCwd = normalizeLocalPath(asString(runCommand?.cwd));
    if (runCommandCwd) {
      return runCommandCwd;
    }

    const listDirectory = isObject(step.listDirectory) ? step.listDirectory : undefined;
    const directoryPath = normalizeLocalPath(asString(listDirectory?.directoryPathUri));
    if (directoryPath) {
      return directoryPath;
    }

    const find = isObject(step.find) ? step.find : undefined;
    const searchDirectory = normalizeLocalPath(asString(find?.searchDirectory));
    if (searchDirectory) {
      return searchDirectory;
    }

    const viewFile = isObject(step.viewFile) ? step.viewFile : undefined;
    const absolutePath = normalizeLocalPath(asString(viewFile?.absolutePathUri));
    if (absolutePath) {
      return path.dirname(absolutePath);
    }
  }

  return undefined;
}

function truncateToolResult(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }
  return truncate(normalized, TOOL_RESULT_PREVIEW_LIMIT);
}

function extractStepTimestamp(step: Record<string, unknown>): string | undefined {
  const metadata = isObject(step.metadata) ? step.metadata : undefined;
  return (
    asString(metadata?.createdAt) ??
    asString(metadata?.completedAt) ??
    asString(metadata?.viewableAt) ??
    asString(metadata?.finishedGeneratingAt)
  );
}

function firstStepTimestamp(steps: Record<string, unknown>[]): string | undefined {
  for (const step of steps) {
    const timestamp = extractStepTimestamp(step);
    if (timestamp) {
      return timestamp;
    }
  }
  return undefined;
}

function lastStepTimestamp(steps: Record<string, unknown>[]): string | undefined {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const timestamp = extractStepTimestamp(steps[index] ?? {});
    if (timestamp) {
      return timestamp;
    }
  }
  return undefined;
}

async function defaultDiscoverLiveEndpoint(appDataDir: string): Promise<AntigravityLiveEndpoint | undefined> {
  let processes: Array<Omit<AntigravityLiveEndpoint, "apiPort" | "candidatePorts">>;
  try {
    processes = await listLanguageServerProcesses(appDataDir);
  } catch {
    return undefined;
  }

  for (const candidate of processes) {
    const candidatePorts = await buildCandidatePorts(candidate.pid, candidate.extensionServerPort);
    for (const apiPort of candidatePorts) {
      try {
        await defaultCallLanguageServer({ ...candidate, apiPort, candidatePorts }, "GetUserStatus", {});
        return { ...candidate, apiPort, candidatePorts };
      } catch {
        continue;
      }
    }
  }

  return undefined;
}

async function listLanguageServerProcesses(
  appDataDir: string,
): Promise<Array<Omit<AntigravityLiveEndpoint, "apiPort" | "candidatePorts">>> {
  const { stdout } = await execFileAsync("ps", ["axww", "-o", "pid=,command="], {
    maxBuffer: 10 * 1024 * 1024,
  });

  const matches: Array<Omit<AntigravityLiveEndpoint, "apiPort" | "candidatePorts">> = [];
  for (const rawLine of stdout.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line.includes("language_server_")) {
      continue;
    }
    if (!line.includes(`--app_data_dir ${appDataDir}`)) {
      continue;
    }

    const match = line.match(/^(\d+)\s+(.*)$/u);
    if (!match) {
      continue;
    }

    const pid = Number.parseInt(match[1] ?? "", 10);
    const command = match[2] ?? "";
    const csrfToken = extractFlagValue(command, "--csrf_token");
    const extensionServerPortText = extractFlagValue(command, "--extension_server_port");
    const extensionServerPort = extensionServerPortText ? Number.parseInt(extensionServerPortText, 10) : Number.NaN;
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

  return matches;
}

function extractFlagValue(command: string, flagName: string): string | undefined {
  const parts = command.split(/\s+/u);
  const index = parts.findIndex((part) => part === flagName);
  if (index === -1) {
    return undefined;
  }
  return parts[index + 1];
}

async function buildCandidatePorts(pid: number, extensionServerPort: number): Promise<number[]> {
  const ports = [extensionServerPort + 1];
  try {
    const { stdout } = await execFileAsync("lsof", ["-Pan", "-p", String(pid), "-iTCP", "-sTCP:LISTEN"], {
      maxBuffer: 1024 * 1024,
    });
    for (const rawLine of stdout.split(/\r?\n/u)) {
      const match = rawLine.match(/127\.0\.0\.1:(\d+)\s+\(LISTEN\)/u);
      if (!match) {
        continue;
      }
      const port = Number.parseInt(match[1] ?? "", 10);
      if (Number.isFinite(port)) {
        ports.push(port);
      }
    }
  } catch {
    // Keep the +1 port heuristic if lsof is unavailable.
  }
  return uniqueNumbers(ports);
}

async function defaultCallLanguageServer(
  live: AntigravityLiveEndpoint,
  method: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const url = `https://127.0.0.1:${live.apiPort}/${API_SERVICE}/${method}`;
  return postJson(url, {
    "Content-Type": "application/json",
    "x-codeium-csrf-token": live.csrfToken,
  }, body);
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = httpsRequest(
      url,
      {
        method: "POST",
        rejectUnauthorized: false,
        headers: {
          ...headers,
          "Content-Length": Buffer.byteLength(payload).toString(),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if ((response.statusCode ?? 0) >= 400) {
            reject(new Error(`HTTP ${response.statusCode}: ${text}`));
            return;
          }
          try {
            const parsed = text ? (JSON.parse(text) as unknown) : {};
            resolve(isObject(parsed) ? parsed : {});
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

async function defaultListConversationPbIds(conversationDir: string): Promise<string[]> {
  try {
    const entries = await readdir(conversationDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".pb"))
      .map((entry) => entry.name.slice(0, -3));
  } catch {
    return [];
  }
}

function normalizeLocalPath(value: string | undefined): string | undefined {
  const normalized = normalizeLocalPathIdentity(value);
  if (!normalized) {
    return undefined;
  }
  return normalized.startsWith("/") || /^[a-z]:/u.test(normalized) ? normalized : undefined;
}

function uniqueNumbers(values: number[]): number[] {
  const seen = new Set<number>();
  const unique: number[] = [];
  for (const value of values) {
    if (!Number.isFinite(value) || seen.has(value)) {
      continue;
    }
    seen.add(value);
    unique.push(value);
  }
  return unique;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    unique.push(value);
  }
  return unique;
}


