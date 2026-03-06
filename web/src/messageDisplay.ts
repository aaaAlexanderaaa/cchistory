import type { UiCopy } from "./i18n";
import type { Message, MessageRole } from "./types";

export type TemplateScope = MessageRole | "all";

export interface PromptInjectionTemplate {
  id: string;
  name: string;
  matchText: string;
  summary: string;
  appliesTo: TemplateScope;
  enabled: boolean;
}

export const PROMPT_TEMPLATE_STORAGE_KEY = "cchistory-prompt-templates";

export const DEFAULT_PROMPT_TEMPLATES: PromptInjectionTemplate[] = [
  {
    id: "assistant-rules-wrapper",
    name: "Assistant rules wrapper",
    matchText: "[Assistant Rules - You MUST follow these instructions]",
    summary: "Injected assistant rules wrapper",
    appliesTo: "system",
    enabled: true,
  },
  {
    id: "continuation-summary",
    name: "Continuation summary",
    matchText:
      "This session is being continued from a previous conversation that ran out of context.",
    summary: "Session continuation summary",
    appliesTo: "system",
    enabled: true,
  },
  {
    id: "request-interrupted",
    name: "Interruption marker",
    matchText: "[Request interrupted by user",
    summary: "Request interrupted",
    appliesTo: "system",
    enabled: true,
  },
];

function normalizeTemplate(
  template: Partial<PromptInjectionTemplate> | null | undefined,
  index: number
): PromptInjectionTemplate | null {
  if (!template) return null;
  const name = typeof template.name === "string" ? template.name.trim() : "";
  const matchText = typeof template.matchText === "string" ? template.matchText : "";
  const summary = typeof template.summary === "string" ? template.summary : "";
  const appliesTo = template.appliesTo;
  const enabled = typeof template.enabled === "boolean" ? template.enabled : true;
  if (!name || !matchText) return null;
  if (
    appliesTo !== "all" &&
    appliesTo !== "user" &&
    appliesTo !== "assistant" &&
    appliesTo !== "system" &&
    appliesTo !== "tool"
  ) {
    return null;
  }

  return {
    id:
      typeof template.id === "string" && template.id
        ? template.id
        : `template-${index}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    matchText,
    summary: summary.trim() || name,
    appliesTo,
    enabled,
  };
}

export function sanitizePromptInjectionTemplates(
  templates: unknown
): PromptInjectionTemplate[] {
  if (!Array.isArray(templates)) {
    return DEFAULT_PROMPT_TEMPLATES.map((template) => ({ ...template }));
  }

  const normalized = templates
    .map((template, index) =>
      normalizeTemplate(template as Partial<PromptInjectionTemplate>, index)
    )
    .filter((template): template is PromptInjectionTemplate => template !== null);

  if (normalized.length === 0) {
    return DEFAULT_PROMPT_TEMPLATES.map((template) => ({ ...template }));
  }
  return normalized;
}

export function loadPromptInjectionTemplates(): PromptInjectionTemplate[] {
  if (typeof window === "undefined") {
    return DEFAULT_PROMPT_TEMPLATES.map((template) => ({ ...template }));
  }

  const raw = window.localStorage.getItem(PROMPT_TEMPLATE_STORAGE_KEY);
  if (!raw) {
    return DEFAULT_PROMPT_TEMPLATES.map((template) => ({ ...template }));
  }

  try {
    return sanitizePromptInjectionTemplates(JSON.parse(raw));
  } catch {
    return DEFAULT_PROMPT_TEMPLATES.map((template) => ({ ...template }));
  }
}

export function createPromptInjectionTemplate(): PromptInjectionTemplate {
  return {
    id: `template-${Date.now().toString(36)}`,
    name: "New template",
    matchText: "",
    summary: "",
    appliesTo: "system",
    enabled: true,
  };
}

function scopeMatches(template: PromptInjectionTemplate, role: MessageRole): boolean {
  return template.appliesTo === "all" || template.appliesTo === role;
}

export function matchPromptInjectionTemplate(
  message: Message,
  templates: PromptInjectionTemplate[]
): PromptInjectionTemplate | null {
  if (!message.content) return null;
  return (
    templates.find(
      (template) =>
        template.enabled &&
        scopeMatches(template, message.role) &&
        message.content.includes(template.matchText)
    ) ?? null
  );
}

function blockType(message: Message): string | null {
  return typeof message.metadata?.block_type === "string" ? message.metadata.block_type : null;
}

export function shouldCollapseMessageByDefault(
  message: Message,
  templates: PromptInjectionTemplate[]
): boolean {
  if (message.role === "assistant") return true;
  if (matchPromptInjectionTemplate(message, templates)) return true;
  return ["prompt_injection", "continuation_summary"].includes(blockType(message) ?? "");
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function buildCollapsedPreview(
  message: Message,
  templates: PromptInjectionTemplate[]
): string {
  const matched = matchPromptInjectionTemplate(message, templates);
  if (matched) return matched.summary;
  const compact = collapseWhitespace(message.content || "");
  return compact.length > 220 ? `${compact.slice(0, 217)}…` : compact;
}

export function messageKindLabel(
  message: Message,
  copy: UiCopy["conversation"]
): string | null {
  const matched = blockType(message);
  if (!matched) return null;
  if (matched === "system_event") {
    const subtype =
      typeof message.metadata?.system_subtype === "string"
        ? message.metadata.system_subtype
        : null;
    return (subtype && copy.messageKinds[subtype]) ?? copy.messageKinds[matched] ?? null;
  }
  return copy.messageKinds[matched] ?? null;
}

export function terminationReasonLabel(
  reason: string | null | undefined,
  copy: UiCopy["conversation"]
): string | null {
  if (!reason) return null;
  return copy.terminationReasons[reason] ?? reason.replace(/_/g, " ");
}

export function metadataString(message: Message, key: string): string | null {
  const value = message.metadata?.[key];
  return typeof value === "string" && value ? value : null;
}
