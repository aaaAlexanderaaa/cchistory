import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type {
  ActorKind,
  AtomEdge,
  ConversationAtom,
  DisplayPolicy,
  OriginKind,
  RawRecord,
  SourceFragment,
  LossAuditRecord,
  SourcePlatform,
  StageKind,
} from "@cchistory/domain";
import { normalizeLocalPathIdentity, stableId, nowIso, minIso, maxIso } from "@cchistory/domain";
import { getPlatformAdapter } from "../platforms/registry.js";
import { getBuiltinMaskTemplates } from "../masks.js";
import { firstNonEmptyTrimmedLineFromBuffer } from "./jsonl-records.js";
import type { AssistantStopReason, FragmentBuildContext, GitProjectEvidence, LossAuditOptions, UserTextChunk, TokenUsageMetrics } from "./types.js";

export const RULE_VERSION = "2026-03-10.1";

/** Normalize backslash path separators to forward slashes. */
export function normalizePathSeparators(value: string): string {
  return value.replace(/\\/g, "/");
}
const execFileAsync = promisify(execFile);
class TtlCache<K, V> {
  private entries = new Map<K, { value: V; expiresAt: number }>();
  constructor(private maxSize: number, private ttlMs: number) {}

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.entries.size >= this.maxSize) {
      // Evict oldest (first inserted — Map preserves insertion order)
      const firstKey = this.entries.keys().next().value;
      if (firstKey !== undefined) this.entries.delete(firstKey);
    }
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}

const gitProjectEvidenceCache = new TtlCache<string, Promise<GitProjectEvidence | undefined>>(200, 5 * 60 * 1000);
const CLAUDE_INTERRUPTION_MARKERS = new Set([
  "[Request interrupted by user]",
  "I'll stop here for now.",
  "I'll stop here to avoid making too many changes at once.",
  "Stopping here to let you review the changes.",
]);

export function buildStageRunId(sourceId: string, stageKind: StageKind): string {
  return stableId("stage-run", sourceId, stageKind);
}

export function createFragment(
  context: FragmentBuildContext,
  record: RawRecord,
  seqNo: number,
  fragmentKind: SourceFragment["fragment_kind"],
  timeKey: string,
  payload: Record<string, unknown>,
): SourceFragment {
  return {
    id: stableId("fragment", context.source.id, context.sessionId, record.id, String(seqNo), fragmentKind),
    source_id: context.source.id,
    session_ref: context.sessionId,
    record_id: record.id,
    seq_no: seqNo,
    fragment_kind: fragmentKind,
    actor_kind: payload.actor_kind as ActorKind | undefined,
    origin_kind: payload.origin_kind as OriginKind | undefined,
    time_key: timeKey,
    payload,
    raw_refs: [record.id],
    source_format_profile_id: context.profileId,
  };
}

export function createEdge(
  sourceId: string,
  sessionRef: string,
  fromAtomId: string,
  toAtomId: string,
  edgeKind: AtomEdge["edge_kind"],
): AtomEdge {
  return {
    id: stableId("edge", sourceId, sessionRef, fromAtomId, toAtomId, edgeKind),
    source_id: sourceId,
    session_ref: sessionRef,
    from_atom_id: fromAtomId,
    to_atom_id: toAtomId,
    edge_kind: edgeKind,
  };
}

export function createLossAudit(
  sourceId: string,
  scopeRef: string,
  lossKind: LossAuditRecord["loss_kind"],
  detail: string,
  options: LossAuditOptions = {},
): LossAuditRecord {
  const stageKind = options.stageKind ?? "parse_source_fragments";
  return {
    id: stableId(
      "loss-audit",
      sourceId,
      stageKind,
      options.diagnosticCode ?? lossKind,
      scopeRef,
      detail,
    ),
    source_id: sourceId,
    stage_run_id: buildStageRunId(sourceId, stageKind),
    stage_kind: stageKind,
    diagnostic_code: options.diagnosticCode ?? lossKind,
    severity: options.severity ?? "warning",
    scope_ref: scopeRef,
    session_ref: options.sessionRef,
    blob_ref: options.blobRef,
    record_ref: options.recordRef,
    fragment_ref: options.fragmentRef,
    atom_ref: options.atomRef,
    candidate_ref: options.candidateRef,
    source_format_profile_id: options.sourceFormatProfileId,
    loss_kind: lossKind,
    detail,
    created_at: nowIso(),
  };
}

export function splitUserText(
  text: string,
  options: {
    platform?: SourcePlatform;
    filePath?: string;
  } = {},
): UserTextChunk[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  if (isDelegatedInstructionUserText(options.platform, options.filePath, normalized)) {
    return [{ originKind: "delegated_instruction", text: normalized }];
  }

  if (isAutomationTriggerUserText(normalized)) {
    return [{ originKind: "automation_trigger", text: normalized }];
  }

  const requestMarker = "[User Request]";
  const requestIndex = normalized.indexOf(requestMarker);
  if (requestIndex >= 0) {
    const before = normalized.slice(0, requestIndex).trim();
    const after = normalized.slice(requestIndex + requestMarker.length).trim();
    const chunks: UserTextChunk[] = [];
    if (before) {
      chunks.push({
        originKind: "injected_user_shaped",
        text: before,
        displayPolicy: "collapse",
      });
    }
    if (after) {
      chunks.push({
        originKind: "user_authored",
        text: after,
      });
    }
    return chunks;
  }

  const chunks: UserTextChunk[] = [];
  let remaining = normalized;
  for (;;) {
    const injectedChunk = extractLeadingInjectedUserChunk(remaining);
    if (!injectedChunk) {
      break;
    }
    chunks.push({
      originKind: "injected_user_shaped",
      text: injectedChunk.text,
      displayPolicy: "collapse",
    });
    remaining = injectedChunk.rest.trim();
  }

  if (chunks.length > 0) {
    if (remaining) {
      chunks.push({
        originKind: "user_authored",
        text: remaining,
      });
    }
    return chunks;
  }

  if (
    normalized.startsWith("[Assistant Rules") ||
    normalized.startsWith("# AGENTS.md instructions") ||
    normalized.startsWith("<environment_context>") ||
    normalized.startsWith("<system-reminder>") ||
    normalized.startsWith("<INSTRUCTIONS>")
  ) {
    return [{ originKind: "injected_user_shaped", text: normalized, displayPolicy: "collapse" }];
  }

  return [{ originKind: "user_authored", text: normalized }];
}

export function extractLeadingInjectedUserChunk(
  text: string,
): { text: string; rest: string } | undefined {
  const patterns = [
    /^# AGENTS\.md instructions[^\n]*\n\n<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>\s*/u,
    /^<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>\s*/u,
    /^<environment_context>[\s\S]*?<\/environment_context>\s*/u,
    /^<system-reminder>[\s\S]*?<\/system-reminder>\s*/u,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match || !match[0]) {
      continue;
    }
    return {
      text: match[0].trim(),
      rest: text.slice(match[0].length),
    };
  }

  return undefined;
}

export function buildTextChunks(
  platform: SourcePlatform,
  actorKind: ActorKind,
  text: string,
  options: {
    filePath?: string;
  } = {},
): UserTextChunk[] {
  if (actorKind === "user") {
    if (platform === "antigravity") {
      const normalized = text.replace(/\r\n/g, "\n").trim();
      return normalized
        ? [
            {
              originKind: "user_authored",
              text: normalized,
            },
          ]
        : [];
    }
    return splitUserText(text, { platform, filePath: options.filePath });
  }
  return [
    {
      originKind: actorKind === "assistant" ? "assistant_authored" : "source_instruction",
      text,
    },
  ];
}

export function extractTextFromContentItem(item: Record<string, unknown>): string | undefined {
  const directText = asString(item.text) ?? asString(item.thinking) ?? asString(item.output_text) ?? asString(item.input_text) ?? asString(item.content);
  if (directText) {
    return directText;
  }
  if (Array.isArray(item.content)) {
    return item.content
      .filter((entry): entry is Record<string, unknown> => isObject(entry))
      .map((entry) => asString(entry.text) ?? asString(entry.content) ?? "")
      .filter(Boolean)
      .join("\n");
  }
  return undefined;
}

export function stringifyToolContent(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is Record<string, unknown> => isObject(entry))
      .map((entry) => asString(entry.text) ?? asString(entry.content) ?? JSON.stringify(entry))
      .join("\n");
  }
  if (isObject(value)) {
    return JSON.stringify(value);
  }
  return asString(value) ?? "";
}

export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function dedupeById<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    unique.push(item);
  }
  return unique;
}

export async function listSourceFiles(
  platform: SourcePlatform,
  baseDir: string,
  limit?: number,
): Promise<string[]> {
  const adapter = getPlatformAdapter(platform);
  const roots = [...(adapter?.getSourceRoots?.(baseDir) ?? [baseDir]), ...(adapter?.getSupplementalSourceRoots?.(baseDir) ?? [])];
  const fileSet = new Set<string>();

  for (const rootDir of roots) {
    if (!(await pathExists(rootDir))) {
      continue;
    }
    for (const filePath of await walkFiles(rootDir)) {
      fileSet.add(filePath);
    }
  }

  const files = [...fileSet];
  const filtered = adapter ? files.filter((filePath) => adapter.matchesSourceFile(filePath)) : [];
  filtered.sort((left, right) => {
    const priorityDelta = getSourceFilePriority(platform, left) - getSourceFilePriority(platform, right);
    return priorityDelta !== 0 ? priorityDelta : left.localeCompare(right);
  });
  return typeof limit === "number" ? filtered.slice(0, limit) : filtered;
}

export async function walkFiles(rootDir: string): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkFiles(fullPath)));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

export function getSourceFilePriority(platform: SourcePlatform, filePath: string): number {
  return getPlatformAdapter(platform)?.getSourceFilePriority?.(filePath) ?? 0;
}

export function deriveSessionId(platform: SourcePlatform, filePath: string, fileBuffer: Buffer): string {
  if (platform === "amp") {
    try {
      const parsed = JSON.parse(fileBuffer.toString("utf8")) as Record<string, unknown>;
      const id = asString(parsed.id);
      if (id) {
        return `sess:${platform}:${id}`;
      }
    } catch {
      return `sess:${platform}:${path.basename(filePath)}`;
    }
  }

  if (platform === "openclaw") {
    return `sess:${platform}:${path.basename(filePath, path.extname(filePath))}`;
  }

  if (platform === "gemini") {
    try {
      const parsed = JSON.parse(fileBuffer.toString("utf8")) as Record<string, unknown>;
      const id = asString(parsed.sessionId) ?? asString(parsed.id);
      if (id) {
        return `sess:${platform}:${id}`;
      }
    } catch {
      return `sess:${platform}:${path.basename(filePath, path.extname(filePath))}`;
    }
  }

  if (platform === "codex") {
    const firstLine = firstNonEmptyTrimmedLineFromBuffer(fileBuffer);
    if (firstLine) {
      try {
        const parsed = JSON.parse(firstLine) as Record<string, unknown>;
        const payload = isObject(parsed.payload) ? parsed.payload : undefined;
        const sessionId = asString(payload?.id);
        if (sessionId) {
          return `sess:${platform}:${sessionId}`;
        }
      } catch {
        return `sess:${platform}:${path.basename(filePath, path.extname(filePath))}`;
      }
    }
  }

  return `sess:${platform}:${path.basename(filePath, path.extname(filePath))}`;
}

export function mapRoleToActor(role: string): ActorKind {
  if (role === "user" || role === "human") {
    return "user";
  }
  if (role === "developer" || role === "system") {
    return "system";
  }
  return "assistant";
}

export function isUserTurnAtom(atom: ConversationAtom): boolean {
  return (
    atom.actor_kind === "user" &&
    atom.content_kind === "text" &&
    (atom.origin_kind === "user_authored" || atom.origin_kind === "injected_user_shaped")
  );
}

export function collapseAntigravityUserTurnAtoms(atoms: ConversationAtom[]): ConversationAtom[] {
  const collapsed: ConversationAtom[] = [];
  let lastKeptUserAtom: ConversationAtom | undefined;
  let assistantSeenSinceLastUser = false;
  for (const atom of atoms) {
    if (atom.actor_kind === "assistant" && atom.content_kind === "text" && atom.display_policy !== "hide") {
      assistantSeenSinceLastUser = true;
    }
    if (isUserTurnAtom(atom)) {
      if (
        lastKeptUserAtom &&
        !assistantSeenSinceLastUser &&
        areAntigravityPromptVariantsSimilar(asString(lastKeptUserAtom.payload.text), asString(atom.payload.text)) &&
        antigravityAtomTimeDeltaMs(lastKeptUserAtom.time_key, atom.time_key) <= 10 * 60 * 1000
      ) {
        continue;
      }
      lastKeptUserAtom = atom;
      assistantSeenSinceLastUser = false;
    }
    collapsed.push(atom);
  }
  return collapsed;
}

export function areAntigravityPromptVariantsSimilar(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = normalizeAntigravityPromptVariant(left);
  const normalizedRight = normalizeAntigravityPromptVariant(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  if (normalizedLeft === normalizedRight) {
    return true;
  }
  const shorter = normalizedLeft.length < normalizedRight.length ? normalizedLeft : normalizedRight;
  const longer = normalizedLeft.length < normalizedRight.length ? normalizedRight : normalizedLeft;
  if (shorter.length >= 24 && longer.includes(shorter)) {
    return true;
  }

  const leftTokens = extractAntigravityPromptSimilarityTokens(normalizedLeft);
  const rightTokens = extractAntigravityPromptSimilarityTokens(normalizedRight);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return false;
  }

  let overlapCount = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlapCount += 1;
    }
  }
  const smallerSize = Math.min(leftTokens.size, rightTokens.size);
  const largerSize = Math.max(leftTokens.size, rightTokens.size);
  return overlapCount >= 4 && overlapCount / smallerSize >= 0.6 && overlapCount / largerSize >= 0.45;
}

export function normalizeAntigravityPromptVariant(value: string | undefined): string | undefined {
  const normalized = value
    ?.toLowerCase()
    .replace(/\*\*/gu, "")
    .replace(/`/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return normalized || undefined;
}

export function extractAntigravityPromptSimilarityTokens(value: string): Set<string> {
  const stopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "into",
    "onto",
    "about",
    "following",
    "established",
    "project",
  ]);
  const tokens = new Set<string>();
  for (const rawToken of value.split(/\s+/u)) {
    const token = normalizeAntigravityPromptSimilarityToken(rawToken);
    if (!token || stopWords.has(token)) {
      continue;
    }
    tokens.add(token);
  }
  return tokens;
}

export function normalizeAntigravityPromptSimilarityToken(token: string): string | undefined {
  if (!token) {
    return undefined;
  }
  if (/^[a-z]{3,}$/u.test(token)) {
    if (token.endsWith("ies") && token.length > 4) {
      return token.slice(0, -3) + "y";
    }
    if (token.endsWith("s") && !token.endsWith("ss") && token.length > 4) {
      return token.slice(0, -1);
    }
    return token;
  }
  if (/[^\x00-\x7f]/u.test(token)) {
    return token.length >= 2 ? token : undefined;
  }
  return token.length >= 3 ? token : undefined;
}

export function antigravityAtomTimeDeltaMs(left: string, right: string): number {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (Number.isNaN(leftMs) || Number.isNaN(rightMs)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs(rightMs - leftMs);
}

export function inferDisplayPolicy(originKind: OriginKind, text: string): DisplayPolicy {
  if (
    originKind === "injected_user_shaped" ||
    originKind === "delegated_instruction" ||
    originKind === "automation_trigger"
  ) {
    return text.length > 180 ? "collapse" : "show";
  }
  return "show";
}

export function isDelegatedInstructionUserText(
  platform: SourcePlatform | undefined,
  filePath: string | undefined,
  text: string,
): boolean {
  if (platform === "claude_code" && filePath && /(^|[\/])subagents([\/]|$)/u.test(filePath)) {
    return true;
  }
  return text.startsWith("[Subagent Context]") || text.startsWith("You are running as a subagent");
}

export function isAutomationTriggerUserText(text: string): boolean {
  return text.startsWith("[cron:");
}

export function isClaudeInterruptionMarker(text: string): boolean {
  return CLAUDE_INTERRUPTION_MARKERS.has(text.trim());
}

export function normalizeFileUri(value: string): string {
  return normalizeLocalPathIdentity(value) ?? value.trim();
}

export function normalizeWorkspacePath(value: string): string | undefined {
  return normalizeLocalPathIdentity(value);
}

export function safeJsonParse(value: string | undefined): unknown {
  if (!value) {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export function compareFragments(left: SourceFragment, right: SourceFragment): number {
  return compareTimeThenSeq(left, right);
}

export function compareTimeThenSeq(
  left: { time_key: string; seq_no: number },
  right: { time_key: string; seq_no: number },
): number {
  if (left.time_key === right.time_key) {
    return left.seq_no - right.seq_no;
  }
  return left.time_key.localeCompare(right.time_key);
}

export { stableId };

export function sha1(value: string | Buffer): string {
  return createHash("sha1").update(value).digest("hex");
}

export function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}...`;
}

export { nowIso };

export { getBuiltinMaskTemplates };

export function epochMillisToIso(value: number | undefined): string | undefined {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return undefined;
  }
  return new Date(value).toISOString();
}

export function coerceIso(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export { minIso, maxIso };

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function readGitProjectEvidence(workingDirectory?: string): Promise<GitProjectEvidence | undefined> {
  const workspacePath = normalizeWorkspacePath(workingDirectory ?? "");
  if (!workspacePath) {
    return undefined;
  }

  let cached = gitProjectEvidenceCache.get(workspacePath);
  if (!cached) {
    cached = loadGitProjectEvidence(workspacePath);
    gitProjectEvidenceCache.set(workspacePath, cached);
  }

  return cached;
}

export async function loadGitProjectEvidence(workspacePath: string): Promise<GitProjectEvidence | undefined> {
  if (!(await pathExists(workspacePath))) {
    return undefined;
  }

  const repoRoot = normalizeWorkspacePath(
    (await runGitCommand(["-C", workspacePath, "rev-parse", "--show-toplevel"])) ?? "",
  );
  if (!repoRoot) {
    return undefined;
  }

  const repoRemote = normalizeGitRemote(await runGitCommand(["-C", repoRoot, "config", "--get", "remote.origin.url"]));

  return {
    repoRoot,
    repoRemote,
    repoFingerprint: repoRemote ? sha1(Buffer.from(`repo-remote:${repoRemote}`)) : undefined,
  };
}

async function runGitCommand(args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      timeout: 2000,
      maxBuffer: 64 * 1024,
    });
    const output = stdout.trim();
    return output || undefined;
  } catch {
    return undefined;
  }
}

export function normalizeGitRemote(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) {
    return undefined;
  }

  let normalized = raw.replace(/\.git$/iu, "").replace(/\/+$/u, "");
  if (/^[^@]+@[^:]+:.+/u.test(normalized)) {
    normalized = normalized.replace(/^([^@]+@[^:]+):/u, "ssh://$1/");
  }

  return normalized;
}

export function sumDefinedNumbers(...values: (number | undefined)[]): number {
  return values.reduce((acc: number, val) => acc + (val ?? 0), 0);
}

export function firstDefinedNumber(...values: (number | undefined)[]): number | undefined {
  return values.find((val) => val !== undefined);
}

export function accumulateTokenUsageMetrics(
  target: TokenUsageMetrics,
  source: TokenUsageMetrics,
): void {
  target.input_tokens = sumDefinedNumbers(target.input_tokens, source.input_tokens);
  target.cache_read_input_tokens = sumDefinedNumbers(
    target.cache_read_input_tokens,
    source.cache_read_input_tokens,
  );
  target.cache_creation_input_tokens = sumDefinedNumbers(
    target.cache_creation_input_tokens,
    source.cache_creation_input_tokens,
  );
  target.cached_input_tokens = sumDefinedNumbers(
    target.cached_input_tokens,
    source.cached_input_tokens,
  );
  target.output_tokens = sumDefinedNumbers(target.output_tokens, source.output_tokens);
  target.reasoning_output_tokens = sumDefinedNumbers(
    target.reasoning_output_tokens,
    source.reasoning_output_tokens,
  );
  target.total_tokens = sumDefinedNumbers(target.total_tokens, source.total_tokens);
  if (source.model) {
    target.model = source.model;
  }
}

export function mergeTokenUsageMetrics(
  left: TokenUsageMetrics | undefined,
  right: TokenUsageMetrics | undefined,
): TokenUsageMetrics | undefined {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  const result = { ...left };
  accumulateTokenUsageMetrics(result, right);
  return result;
}

export function extractTokenUsage(value: unknown, depth = 0): TokenUsageMetrics | undefined {
  if (!isObject(value) || depth > 3) {
    return undefined;
  }

  const direct = normalizeTokenUsageObject(value);
  let nestedUsage: TokenUsageMetrics | undefined;

  for (const nested of [
    value.usage,
    value.token_usage,
    value.tokenUsage,
    value.tokens,
    value.token_count,
    value.tokenCount,
    value.metadata,
    value.last_token_usage,
    value.lastTokenUsage,
  ]) {
    nestedUsage = mergeTokenUsageMetrics(nestedUsage, extractTokenUsage(nested, depth + 1));
  }

  return mergeTokenUsageMetrics(nestedUsage, direct);
}

export function extractCumulativeTokenUsage(value: unknown, depth = 0): TokenUsageMetrics | undefined {
  if (!isObject(value) || depth > 3) {
    return undefined;
  }

  const direct = normalizeTokenUsageObject(value);
  let nestedUsage: TokenUsageMetrics | undefined;

  for (const nested of [value.total_token_usage, value.totalTokenUsage, value.total_usage, value.totalUsage, value.info]) {
    nestedUsage = mergeTokenUsageMetrics(nestedUsage, extractCumulativeTokenUsage(nested, depth + 1));
  }

  return mergeTokenUsageMetrics(nestedUsage, direct);
}

export function normalizeTokenUsageObject(value: Record<string, unknown>): TokenUsageMetrics | undefined {
  const rawInput =
    asNumber(value.input_tokens) ??
    asNumber(value.inputTokens) ??
    asNumber(value.prompt_tokens) ??
    asNumber(value.promptTokens) ??
    asNumber(value.input_token_count) ??
    asNumber(value.inputTokenCount);

  const output =
    asNumber(value.output_tokens) ??
    asNumber(value.outputTokens) ??
    asNumber(value.completion_tokens) ??
    asNumber(value.completionTokens) ??
    asNumber(value.output_token_count) ??
    asNumber(value.outputTokenCount);

  const total =
    asNumber(value.total_tokens) ??
    asNumber(value.totalTokens) ??
    asNumber(value.total_token_count) ??
    asNumber(value.totalTokenCount);

  const rawCacheRead =
    asNumber(value.cache_read_input_tokens) ??
    asNumber(value.cacheReadInputTokens) ??
    asNumber(value.cacheReadTokens) ??
    asNumber(value.cache_read_tokens);
  const rawCacheCreation =
    asNumber(value.cache_creation_input_tokens) ??
    asNumber(value.cacheCreationInputTokens) ??
    asNumber(value.cacheCreationTokens) ??
    asNumber(value.cache_creation_tokens);
  const rawCachedInput = asNumber(value.cached_input_tokens) ?? asNumber(value.cachedInputTokens);
  const reasoningOutput =
    asNumber(value.reasoning_output_tokens) ??
    asNumber(value.reasoningOutputTokens) ??
    asNumber(value.thinkingTokens) ??
    asNumber(value.thinking_tokens);

  if (
    rawInput === undefined &&
    output === undefined &&
    total === undefined &&
    rawCacheRead === undefined &&
    rawCacheCreation === undefined &&
    rawCachedInput === undefined &&
    reasoningOutput === undefined
  ) {
    return undefined;
  }

  // When cached_input_tokens is given but cache_read/cache_creation are not,
  // the platform reports cached as a lump sum (e.g. Codex). Map it to cache_read
  // and subtract from input_tokens to yield non-cached input.
  let cacheRead = rawCacheRead;
  let cacheCreation = rawCacheCreation;
  let input = rawInput;
  let cachedInput = rawCachedInput;

  if (cachedInput !== undefined && cacheRead === undefined && cacheCreation === undefined) {
    cacheRead = cachedInput;
    if (input !== undefined) {
      input = input - cachedInput;
    }
  }

  // Derive cached_input_tokens when not directly provided but cache_read/cache_creation are
  if (cachedInput === undefined && (cacheRead !== undefined || cacheCreation !== undefined)) {
    cachedInput = (cacheCreation ?? 0) + (cacheRead ?? 0);
  }

  // Compute total including cache tokens: input + output + cache_creation + cache_read
  const computedTotal =
    total ??
    sumDefinedNumbers(input, output, cacheCreation, cacheRead);

  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: computedTotal,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheCreation,
    cached_input_tokens: cachedInput,
    reasoning_output_tokens: reasoningOutput,
    model: asString(value.model),
  };
}

export function extractTokenUsageFromPayload(payload: Record<string, unknown>): TokenUsageMetrics | undefined {
  return extractTokenUsage(payload.token_usage ?? payload.usage ?? payload.tokenUsage ?? payload);
}

export function extractTokenCountFromPayload(payload: Record<string, unknown>): number | undefined {
  return (
    asNumber(payload.token_count) ??
    asNumber(payload.tokenCount) ??
    asNumber(payload.tokens) ??
    asNumber(payload.total_tokens) ??
    asNumber(payload.totalTokens)
  );
}

export function extractStopReasonFromPayload(payload: Record<string, unknown>): AssistantStopReason | undefined {
  return normalizeStopReason(asString(payload.stop_reason) ?? asString(payload.finish_reason));
}

export function normalizeStopReason(value: unknown): AssistantStopReason | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/gu, "_");
  if (
    normalized === "end_turn" ||
    normalized === "end" ||
    normalized === "stop" ||
    normalized === "completed" ||
    normalized === "complete" ||
    normalized === "finished"
  ) {
    return "end_turn";
  }
  if (
    normalized === "tool_use" ||
    normalized === "tool_call" ||
    normalized === "tool_calls" ||
    normalized === "function_call" ||
    normalized === "function_calls"
  ) {
    return "tool_use";
  }
  if (normalized === "max_tokens" || normalized === "length" || normalized === "token_limit") {
    return "max_tokens";
  }
  if (
    normalized === "error" ||
    normalized === "failed" ||
    normalized === "failure" ||
    normalized === "abort" ||
    normalized === "aborted" ||
    normalized === "cancelled" ||
    normalized === "canceled" ||
    normalized === "interrupted"
  ) {
    return "error";
  }
  return undefined;
}

export function diffTokenUsageMetrics(
  current: TokenUsageMetrics,
  previous: TokenUsageMetrics | undefined,
): TokenUsageMetrics {
  if (!previous) {
    return current;
  }
  const diffField = (
    cur: number | undefined,
    prev: number | undefined,
  ): number | undefined => {
    if (cur == null && prev == null) return undefined;
    return Math.max(0, (cur ?? 0) - (prev ?? 0));
  };
  return {
    input_tokens: diffField(current.input_tokens, previous.input_tokens),
    output_tokens: diffField(current.output_tokens, previous.output_tokens),
    total_tokens: diffField(current.total_tokens, previous.total_tokens),
    cache_read_input_tokens: diffField(current.cache_read_input_tokens, previous.cache_read_input_tokens),
    cache_creation_input_tokens: diffField(current.cache_creation_input_tokens, previous.cache_creation_input_tokens),
    cached_input_tokens: diffField(current.cached_input_tokens, previous.cached_input_tokens),
    reasoning_output_tokens: diffField(current.reasoning_output_tokens, previous.reasoning_output_tokens),
    model: current.model,
  };
}
