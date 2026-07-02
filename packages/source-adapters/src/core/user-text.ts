import type {
  ActorKind,
  DisplayPolicy,
  OriginKind,
  SourcePlatform,
} from "@cchistory/domain";
import type { UserTextChunk } from "./types.js";
import { asString, isObject } from "./type-guards.js";

const CLAUDE_INTERRUPTION_MARKERS = new Set([
  "[Request interrupted by user]",
  "I'll stop here for now.",
  "I'll stop here to avoid making too many changes at once.",
  "Stopping here to let you review the changes.",
]);

const SYNTHETIC_USER_SHAPED_PREFIXES = [
  "<user_action>",
  "<task-notification>",
  "<turn_aborted>",
  "<local-command-caveat>",
  "<local-command-stdout>",
  "<bash-input>",
  "<bash-stdout>",
] as const;

const CONTINUATION_PREFIX = "This session is being continued from a previous conversation";

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

  const commandEnvelope = splitLocalCommandEnvelope(normalized);
  if (commandEnvelope) {
    return commandEnvelope;
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

  if (isSyntheticUserShapedText(normalized)) {
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

export function splitLocalCommandEnvelope(text: string): UserTextChunk[] | undefined {
  if (
    !text.startsWith("<command-name>") &&
    !text.startsWith("<command-message>") &&
    !text.startsWith("<command-args>")
  ) {
    return undefined;
  }

  if (text.replace(/<command-(name|message|args)>[\s\S]*?<\/command-\1>/gu, "").trim()) {
    return undefined;
  }

  const commandName = extractCommandEnvelopeField(text, "name");
  const commandMessage = extractCommandEnvelopeField(text, "message");
  const commandArgs = extractCommandEnvelopeField(text, "args");
  const commandKey = normalizeCommandKey(commandName) ?? normalizeCommandKey(commandMessage);
  const chunks: UserTextChunk[] = [
    {
      originKind: "injected_user_shaped",
      text,
      displayPolicy: "collapse",
    },
  ];

  if (commandKey === "clear" && !commandArgs) {
    return chunks;
  }

  const authoredText = commandArgs || commandMessage || stripLeadingSlash(commandName);
  if (authoredText) {
    chunks.push({
      originKind: "user_authored",
      text: authoredText,
    });
  }
  return chunks;
}

function extractCommandEnvelopeField(text: string, field: "name" | "message" | "args"): string | undefined {
  const match = text.match(new RegExp(`<command-${field}>([\\s\\S]*?)<\\/command-${field}>`, "u"));
  const value = match?.[1]?.replace(/\r\n/g, "\n").trim();
  return value || undefined;
}

function normalizeCommandKey(value: string | undefined): string | undefined {
  const stripped = stripLeadingSlash(value);
  return stripped?.toLowerCase();
}

function stripLeadingSlash(value: string | undefined): string | undefined {
  const stripped = value?.trim().replace(/^\/+/u, "").trim();
  return stripped || undefined;
}

/**
 * Detects messages that are structurally `role: user` in the raw data but
 * are system-injected rather than human-authored.  Covers patterns from
 * Codex (review actions, turn_aborted) and Claude Code (sub-agent
 * callbacks, compact-continuation summaries, local-command wrappers).
 */
export function isSyntheticUserShapedText(text: string): boolean {
  for (const prefix of SYNTHETIC_USER_SHAPED_PREFIXES) {
    if (text.startsWith(prefix)) return true;
  }
  if (text.startsWith(CONTINUATION_PREFIX)) return true;
  return false;
}

export function isClaudeInterruptionMarker(text: string): boolean {
  return CLAUDE_INTERRUPTION_MARKERS.has(text.trim());
}
