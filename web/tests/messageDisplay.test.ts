import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PROMPT_TEMPLATES,
  buildCollapsedPreview,
  matchPromptInjectionTemplate,
  sanitizePromptInjectionTemplates,
  shouldCollapseMessageByDefault,
} from "../src/messageDisplay.ts";
import type { Message } from "../src/types/index.ts";

function message(overrides: Partial<Message>): Message {
  return {
    role: "user",
    content: "",
    metadata: {},
    ...overrides,
  };
}

test("matches default wrapper template and simplifies preview", () => {
  const wrapped = message({
    role: "system",
    content:
      "[Assistant Rules - You MUST follow these instructions]\n[User Request]\ncontinue",
    metadata: { block_type: "prompt_injection" },
  });

  const matched = matchPromptInjectionTemplate(wrapped, DEFAULT_PROMPT_TEMPLATES);
  assert.equal(matched?.id, "assistant-rules-wrapper");
  assert.equal(buildCollapsedPreview(wrapped, DEFAULT_PROMPT_TEMPLATES), matched?.summary);
});

test("assistant messages collapse by default", () => {
  const assistant = message({
    role: "assistant",
    content: "I will inspect the parser and UI behavior next.",
  });

  assert.equal(shouldCollapseMessageByDefault(assistant, DEFAULT_PROMPT_TEMPLATES), true);
});

test("synthetic continuation summaries collapse by default", () => {
  const continuation = message({
    role: "system",
    content: "This session is being continued from a previous conversation.",
    metadata: { block_type: "continuation_summary" },
  });

  assert.equal(shouldCollapseMessageByDefault(continuation, DEFAULT_PROMPT_TEMPLATES), true);
});

test("invalid template payload falls back to defaults", () => {
  const sanitized = sanitizePromptInjectionTemplates([{ foo: "bar" }]);
  assert.equal(sanitized.length, DEFAULT_PROMPT_TEMPLATES.length);
  assert.equal(sanitized[0].id, DEFAULT_PROMPT_TEMPLATES[0].id);
});
