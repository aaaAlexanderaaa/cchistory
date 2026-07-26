import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMasks,
  countOriginalChars,
  extractCanonicalText,
} from "./mask-utils.ts";
import {
  buildTokenUsageItems,
  formatTokenTrackingLabel,
  normalizeTokenUsage,
} from "./token-usage.ts";

test("Web masking keeps source text recoverable while excluding collapsed content from canonical display text", () => {
  const rawText = "before SECRET after";
  const segments = applyMasks(
    rawText,
    [
      {
        id: "mask-secret",
        name: "Secret",
        match_type: "contains",
        match_pattern: "SECRET",
        action: "collapse",
        collapse_label: "Sensitive value",
        priority: 0,
        applies_to: ["user_message"],
        is_active: true,
      },
    ],
    "user_message",
  );

  assert.equal(segments.length, 3);
  assert.deepEqual(segments[1], {
    type: "masked",
    content: "[MASKED: Sensitive value]",
    mask_label: "Sensitive value",
    mask_char_count: 6,
    mask_template_id: "mask-secret",
    original_content: "SECRET",
    is_expanded: false,
  });
  assert.equal(extractCanonicalText(segments), "before  after");
  assert.equal(countOriginalChars(segments), rawText.length);
});

test("Web token usage normalizes cache variants and renders deterministic summary items", () => {
  const usage = normalizeTokenUsage({
    input_tokens: 10,
    cache_read_input_tokens: 4,
    cache_creation_input_tokens: 2,
    output_tokens: 3,
  });

  assert.deepEqual(usage, {
    input_tokens: 10,
    cache_read_input_tokens: 4,
    cache_creation_input_tokens: 2,
    cached_input_tokens: 6,
    output_tokens: 3,
    reasoning_output_tokens: undefined,
    total_tokens: 19,
  });
  assert.deepEqual(
    buildTokenUsageItems(usage).map((item) => [item.key, item.value]),
    [
      ["input", "10"],
      ["cache-read", "4"],
      ["cache-write", "2"],
      ["output", "3"],
      ["total", "19"],
    ],
  );
  assert.equal(formatTokenTrackingLabel(2, 3), "2/3 tracked");
  assert.equal(formatTokenTrackingLabel(0, 3), "Token tracking unavailable");
});
