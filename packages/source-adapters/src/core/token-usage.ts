import type { AssistantStopReason, TokenUsageMetrics } from "./types.js";
import { asNumber, asString, isObject, sumDefinedNumbers } from "./type-guards.js";

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

  // Total = input + output + cache_creation + cache_read ("option B" — true billed
  // throughput, intentionally includes cache). Vendor dashboards and most agent
  // headlines show input + output only; our number is meant to be higher. Do not
  // revert without updating every display surface that decomposes Total.
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
