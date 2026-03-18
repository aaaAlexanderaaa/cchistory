import type { DisplaySegment } from "@cchistory/domain";

export type MaskApplicationContext =
  | "user_message"
  | "system_message"
  | "assistant_reply"
  | "tool_input"
  | "tool_output";

export type BuiltinMaskMatchType = "regex" | "prefix" | "contains";

export interface BuiltinMaskTemplate {
  id: string;
  name: string;
  description?: string;
  match_type: BuiltinMaskMatchType;
  match_pattern: string;
  action: "collapse";
  collapse_label: string;
  priority: number;
  applies_to: MaskApplicationContext[];
  is_builtin: true;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface MatchRegion {
  start: number;
  end: number;
  content: string;
  template: BuiltinMaskTemplate;
}

interface MaskApplicationResult {
  display_segments: DisplaySegment[];
  canonical_text: string;
}

export const LITERAL_PROMPT_MASK_TEMPLATE_IDS = [
  "mask-agents-md-instructions",
  "mask-standalone-instructions-block",
  "mask-environment-context-block",
  "mask-system-reminder-block",
] as const;

const BUILTIN_MASK_TEMPLATES: readonly BuiltinMaskTemplate[] = [
  {
    id: "mask-agents-md-instructions",
    name: "AGENTS.md Instructions",
    description: "Collapses injected AGENTS.md scaffolding while preserving the original evidence for expansion.",
    match_type: "regex",
    match_pattern: "# AGENTS\\.md instructions[^\\n]*\\n\\n<INSTRUCTIONS>[\\s\\S]*?</INSTRUCTIONS>",
    action: "collapse",
    collapse_label: "Agent Instructions",
    priority: 0,
    applies_to: ["user_message", "system_message"],
    is_builtin: true,
    is_active: true,
    created_at: "2026-03-12T00:00:00.000Z",
    updated_at: "2026-03-12T00:00:00.000Z",
  },
  {
    id: "mask-standalone-instructions-block",
    name: "Standalone Instructions Block",
    description: "Collapses injected instruction envelopes that arrive without an AGENTS.md heading.",
    match_type: "regex",
    match_pattern: "<INSTRUCTIONS>[\\s\\S]*?</INSTRUCTIONS>",
    action: "collapse",
    collapse_label: "Instructions",
    priority: 1,
    applies_to: ["user_message", "system_message"],
    is_builtin: true,
    is_active: true,
    created_at: "2026-03-12T00:00:00.000Z",
    updated_at: "2026-03-12T00:00:00.000Z",
  },
  {
    id: "mask-environment-context-block",
    name: "Environment Context",
    description: "Collapses injected execution environment envelopes while preserving expandable evidence.",
    match_type: "regex",
    match_pattern: "<environment_context>[\\s\\S]*?</environment_context>",
    action: "collapse",
    collapse_label: "Environment Context",
    priority: 2,
    applies_to: ["user_message", "system_message"],
    is_builtin: true,
    is_active: true,
    created_at: "2026-03-12T00:00:00.000Z",
    updated_at: "2026-03-12T00:00:00.000Z",
  },
  {
    id: "mask-system-reminder-block",
    name: "System Reminder",
    description: "Collapses injected reminder envelopes in captured user-shaped text.",
    match_type: "regex",
    match_pattern: "<system-reminder>[\\s\\S]*?</system-reminder>",
    action: "collapse",
    collapse_label: "System Reminder",
    priority: 3,
    applies_to: ["user_message", "system_message"],
    is_builtin: true,
    is_active: true,
    created_at: "2026-03-12T00:00:00.000Z",
    updated_at: "2026-03-12T00:00:00.000Z",
  },
  {
    id: "mask-system-prompt-prefix",
    name: "System Prompt Prefix",
    description: "Collapses assistant or system prompt prefixes that start with common agent instructions.",
    match_type: "prefix",
    match_pattern: "You are",
    action: "collapse",
    collapse_label: "System Prompt",
    priority: 4,
    applies_to: ["system_message", "assistant_reply"],
    is_builtin: true,
    is_active: true,
    created_at: "2026-03-09T00:00:00.000Z",
    updated_at: "2026-03-09T00:00:00.000Z",
  },
  {
    id: "mask-openai-key",
    name: "OpenAI API Key",
    description: "Collapses OpenAI-style API keys.",
    match_type: "regex",
    match_pattern: "sk-[A-Za-z0-9]{20,}",
    action: "collapse",
    collapse_label: "API Key",
    priority: 5,
    applies_to: ["user_message", "system_message", "assistant_reply", "tool_input", "tool_output"],
    is_builtin: true,
    is_active: true,
    created_at: "2026-03-09T00:00:00.000Z",
    updated_at: "2026-03-09T00:00:00.000Z",
  },
  {
    id: "mask-private-key",
    name: "Private Key Block",
    description: "Collapses PEM and SSH private key blocks.",
    match_type: "regex",
    match_pattern: "-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----",
    action: "collapse",
    collapse_label: "Private Key",
    priority: 6,
    applies_to: ["user_message", "system_message", "assistant_reply", "tool_input", "tool_output"],
    is_builtin: true,
    is_active: true,
    created_at: "2026-03-09T00:00:00.000Z",
    updated_at: "2026-03-09T00:00:00.000Z",
  },
  {
    id: "mask-bearer-token",
    name: "Bearer Token",
    description: "Collapses bearer tokens in tool payloads and messages.",
    match_type: "regex",
    match_pattern: "Bearer\\s+[A-Za-z0-9._\\-]{16,}",
    action: "collapse",
    collapse_label: "Bearer Token",
    priority: 7,
    applies_to: ["user_message", "system_message", "assistant_reply", "tool_input", "tool_output"],
    is_builtin: true,
    is_active: true,
    created_at: "2026-03-09T00:00:00.000Z",
    updated_at: "2026-03-09T00:00:00.000Z",
  },
];

export function getBuiltinMaskTemplates(): BuiltinMaskTemplate[] {
  return BUILTIN_MASK_TEMPLATES.map((template) => ({ ...template, applies_to: [...template.applies_to] }));
}

export function applyMaskTemplates(
  rawText: string,
  context: MaskApplicationContext,
  options: { injected?: boolean; exclude_template_ids?: readonly string[] } = {},
): MaskApplicationResult {
  if (rawText.length === 0) {
    return { display_segments: [{ type: options.injected ? "injected" : "text", content: "" }], canonical_text: "" };
  }

  const excludedTemplateIds = new Set(options.exclude_template_ids ?? []);
  const templates = getBuiltinMaskTemplates()
    .filter(
      (template) =>
        template.is_active &&
        template.applies_to.includes(context) &&
        !excludedTemplateIds.has(template.id),
    )
    .sort((left, right) => left.priority - right.priority);
  const regions: MatchRegion[] = [];

  for (const template of templates) {
    for (const region of findMatches(rawText, template)) {
      if (regions.some((existing) => overlaps(region, existing))) {
        continue;
      }
      regions.push(region);
    }
  }

  regions.sort((left, right) => left.start - right.start);

  const displaySegments: DisplaySegment[] = [];
  let cursor = 0;
  for (const region of regions) {
    if (region.start > cursor) {
      displaySegments.push({
        type: options.injected ? "injected" : "text",
        content: rawText.slice(cursor, region.start),
      });
    }
    displaySegments.push({
      type: "masked",
      content: `[MASKED: ${region.template.collapse_label}]`,
      mask_label: region.template.collapse_label,
      mask_char_count: region.content.length,
      mask_template_id: region.template.id,
      original_content: region.content,
      is_expanded: false,
    });
    cursor = region.end;
  }

  if (cursor < rawText.length) {
    displaySegments.push({
      type: options.injected ? "injected" : "text",
      content: rawText.slice(cursor),
    });
  }

  const canonicalText = extractCanonicalText(displaySegments);
  return {
    display_segments: displaySegments.length > 0 ? displaySegments : [{ type: options.injected ? "injected" : "text", content: rawText }],
    canonical_text: canonicalText,
  };
}

export function extractCanonicalText(segments: readonly DisplaySegment[]): string {
  return segments
    .map((segment) => {
      if (segment.type === "masked" || segment.type === "injected") {
        return "";
      }
      return segment.content;
    })
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function findMatches(rawText: string, template: BuiltinMaskTemplate): MatchRegion[] {
  if (template.match_type === "prefix") {
    if (!rawText.startsWith(template.match_pattern)) {
      return [];
    }
    return [
      {
        start: 0,
        end: findPrefixEnd(rawText),
        content: rawText.slice(0, findPrefixEnd(rawText)),
        template,
      },
    ];
  }

  if (template.match_type === "contains") {
    const regions: MatchRegion[] = [];
    let cursor = 0;
    while (cursor < rawText.length) {
      const foundAt = rawText.indexOf(template.match_pattern, cursor);
      if (foundAt < 0) {
        break;
      }
      regions.push({
        start: foundAt,
        end: foundAt + template.match_pattern.length,
        content: rawText.slice(foundAt, foundAt + template.match_pattern.length),
        template,
      });
      cursor = foundAt + template.match_pattern.length;
    }
    return regions;
  }

  try {
    const regex = new RegExp(template.match_pattern, "g");
    const regions: MatchRegion[] = [];
    for (let match = regex.exec(rawText); match; match = regex.exec(rawText)) {
      regions.push({
        start: match.index,
        end: match.index + match[0].length,
        content: match[0],
        template,
      });
      if (match[0].length === 0) {
        regex.lastIndex += 1;
      }
    }
    return regions;
  } catch {
    return [];
  }
}

function findPrefixEnd(rawText: string): number {
  const separatorCandidates = ["\n\n====", "\n\n---", "\n\nUser:", "\n\nHuman:", "\n\n# "];
  for (const separator of separatorCandidates) {
    const index = rawText.indexOf(separator);
    if (index >= 0) {
      return index;
    }
  }
  return Math.min(rawText.length, 4000);
}

function overlaps(left: MatchRegion, right: MatchRegion): boolean {
  return left.start < right.end && right.start < left.end;
}
