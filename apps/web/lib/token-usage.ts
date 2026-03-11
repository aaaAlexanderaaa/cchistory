import type { TokenUsageSummary, UserTurn } from './types'

export interface AggregatedTokenUsage {
  usage?: TokenUsageSummary
  trackedTurns: number
}

export interface TokenUsageItem {
  key: 'input' | 'cache-read' | 'cache-write' | 'cache' | 'output' | 'reasoning' | 'total'
  label: string
  value: string
  note?: string
}

export function summarizeTurnsTokenUsage(turns: UserTurn[]): AggregatedTokenUsage {
  let trackedTurns = 0
  let inputTokens = 0
  let cacheReadInputTokens = 0
  let cacheCreationInputTokens = 0
  let cachedInputTokens = 0
  let outputTokens = 0
  let reasoningOutputTokens = 0
  let totalTokens = 0
  let hasInputTokens = false
  let hasCacheReadInputTokens = false
  let hasCacheCreationInputTokens = false
  let hasCachedInputTokens = false
  let hasOutputTokens = false
  let hasReasoningOutputTokens = false
  let hasTotalTokens = false

  for (const turn of turns) {
    const usage = normalizeTokenUsage(turn.context_summary.token_usage, turn.context_summary.total_tokens)
    if (!usage) {
      continue
    }

    trackedTurns += 1

    if (typeof usage.input_tokens === 'number') {
      inputTokens += usage.input_tokens
      hasInputTokens = true
    }
    if (typeof usage.cache_read_input_tokens === 'number') {
      cacheReadInputTokens += usage.cache_read_input_tokens
      hasCacheReadInputTokens = true
    }
    if (typeof usage.cache_creation_input_tokens === 'number') {
      cacheCreationInputTokens += usage.cache_creation_input_tokens
      hasCacheCreationInputTokens = true
    }
    if (typeof usage.cached_input_tokens === 'number') {
      cachedInputTokens += usage.cached_input_tokens
      hasCachedInputTokens = true
    }
    if (typeof usage.output_tokens === 'number') {
      outputTokens += usage.output_tokens
      hasOutputTokens = true
    }
    if (typeof usage.reasoning_output_tokens === 'number') {
      reasoningOutputTokens += usage.reasoning_output_tokens
      hasReasoningOutputTokens = true
    }
    if (typeof usage.total_tokens === 'number') {
      totalTokens += usage.total_tokens
      hasTotalTokens = true
    }
  }

  if (
    !hasInputTokens &&
    !hasCacheReadInputTokens &&
    !hasCacheCreationInputTokens &&
    !hasCachedInputTokens &&
    !hasOutputTokens &&
    !hasReasoningOutputTokens &&
    !hasTotalTokens
  ) {
    return { trackedTurns }
  }

  return {
    trackedTurns,
    usage: {
      input_tokens: hasInputTokens ? inputTokens : undefined,
      cache_read_input_tokens: hasCacheReadInputTokens ? cacheReadInputTokens : undefined,
      cache_creation_input_tokens: hasCacheCreationInputTokens ? cacheCreationInputTokens : undefined,
      cached_input_tokens: hasCachedInputTokens ? cachedInputTokens : undefined,
      output_tokens: hasOutputTokens ? outputTokens : undefined,
      reasoning_output_tokens: hasReasoningOutputTokens ? reasoningOutputTokens : undefined,
      total_tokens: hasTotalTokens ? totalTokens : undefined,
    },
  }
}

export function normalizeTokenUsage(
  usage?: TokenUsageSummary,
  fallbackTotal?: number,
): TokenUsageSummary | undefined {
  const cacheReadInputTokens = usage?.cache_read_input_tokens ?? usage?.cached_input_tokens
  const cacheCreationInputTokens = usage?.cache_creation_input_tokens
  const cachedInputTokens =
    usage?.cached_input_tokens ??
    sumDefinedNumbers(cacheReadInputTokens, cacheCreationInputTokens)
  const totalTokens =
    usage?.total_tokens ??
    fallbackTotal ??
    sumDefinedNumbers(
      usage?.input_tokens,
      cacheReadInputTokens,
      cacheCreationInputTokens,
      usage?.output_tokens,
    )

  if (
    usage?.input_tokens === undefined &&
    cacheReadInputTokens === undefined &&
    cacheCreationInputTokens === undefined &&
    cachedInputTokens === undefined &&
    usage?.output_tokens === undefined &&
    usage?.reasoning_output_tokens === undefined &&
    totalTokens === undefined
  ) {
    return undefined
  }

  return {
    input_tokens: usage?.input_tokens,
    cache_read_input_tokens: cacheReadInputTokens,
    cache_creation_input_tokens: cacheCreationInputTokens,
    cached_input_tokens: cachedInputTokens,
    output_tokens: usage?.output_tokens,
    reasoning_output_tokens: usage?.reasoning_output_tokens,
    total_tokens: totalTokens,
  }
}

export function buildTokenUsageItems(
  usage?: TokenUsageSummary,
  fallbackTotal?: number,
): TokenUsageItem[] {
  const normalized = normalizeTokenUsage(usage, fallbackTotal)
  if (!normalized) {
    return []
  }

  const items: TokenUsageItem[] = []
  if (typeof normalized.input_tokens === 'number') {
    items.push({ key: 'input', label: 'INPUT', value: formatTokenValue(normalized.input_tokens) })
  }
  if (typeof normalized.cache_read_input_tokens === 'number') {
    items.push({ key: 'cache-read', label: 'CACHE HIT', value: formatTokenValue(normalized.cache_read_input_tokens) })
  } else if (typeof normalized.cached_input_tokens === 'number') {
    items.push({ key: 'cache', label: 'CACHE', value: formatTokenValue(normalized.cached_input_tokens) })
  }
  if (typeof normalized.cache_creation_input_tokens === 'number') {
    items.push({
      key: 'cache-write',
      label: 'CACHE WRITE',
      value: formatTokenValue(normalized.cache_creation_input_tokens),
    })
  }
  if (typeof normalized.output_tokens === 'number') {
    items.push({ key: 'output', label: 'OUTPUT', value: formatTokenValue(normalized.output_tokens) })
  }
  if (typeof normalized.reasoning_output_tokens === 'number') {
    items.push({
      key: 'reasoning',
      label: 'REASONING',
      value: formatTokenValue(normalized.reasoning_output_tokens),
      note: 'included in output',
    })
  }
  if (typeof normalized.total_tokens === 'number') {
    items.push({ key: 'total', label: 'TOTAL', value: formatTokenValue(normalized.total_tokens) })
  }
  return items
}

export function formatTokenUsageSummary(
  usage: TokenUsageSummary | undefined,
  trackedTurns: number,
  totalTurns: number,
  fallbackTotal?: number,
): string {
  const normalized = normalizeTokenUsage(usage, fallbackTotal)
  if (!normalized) {
    return 'Token tracking unavailable'
  }

  const parts: string[] = []
  if (typeof normalized.input_tokens === 'number') {
    parts.push(`input ${formatTokenValue(normalized.input_tokens)}`)
  }
  if (typeof normalized.cache_read_input_tokens === 'number') {
    parts.push(`cache hit ${formatTokenValue(normalized.cache_read_input_tokens)}`)
  } else if (typeof normalized.cached_input_tokens === 'number') {
    parts.push(`cache ${formatTokenValue(normalized.cached_input_tokens)}`)
  }
  if (typeof normalized.cache_creation_input_tokens === 'number') {
    parts.push(`cache write ${formatTokenValue(normalized.cache_creation_input_tokens)}`)
  }
  if (typeof normalized.output_tokens === 'number') {
    parts.push(`output ${formatTokenValue(normalized.output_tokens)}`)
  }
  if (typeof normalized.total_tokens === 'number') {
    parts.push(`total ${formatTokenValue(normalized.total_tokens)}`)
  }
  if (typeof normalized.reasoning_output_tokens === 'number') {
    parts.push(`${formatTokenValue(normalized.reasoning_output_tokens)} reasoning in output`)
  }
  if (trackedTurns !== totalTurns) {
    parts.push(`${trackedTurns}/${totalTurns} tracked`)
  }
  return parts.join(' · ')
}

export function formatTokenTrackingLabel(trackedTurns: number, totalTurns: number) {
  if (trackedTurns === 0 || totalTurns === 0) {
    return 'Token tracking unavailable'
  }
  return `${trackedTurns}/${totalTurns} tracked`
}

export function formatTokenUsageOverview(
  usage: TokenUsageSummary | undefined,
  trackedTurns: number,
  totalTurns: number,
  fallbackTotal?: number,
) {
  const normalized = normalizeTokenUsage(usage, fallbackTotal)
  if (!normalized) {
    return 'Token tracking unavailable'
  }

  const parts: string[] = []
  if (typeof normalized.total_tokens === 'number') {
    parts.push(`${formatTokenValue(normalized.total_tokens)} total`)
  } else if (typeof normalized.output_tokens === 'number') {
    parts.push(`${formatTokenValue(normalized.output_tokens)} output`)
  } else {
    parts.push('Token telemetry')
  }
  parts.push(formatTokenTrackingLabel(trackedTurns, totalTurns))
  return parts.join(' · ')
}

export function formatTokenValue(value?: number) {
  if (value === undefined) {
    return 'n/a'
  }
  return new Intl.NumberFormat('en-US').format(value)
}

function sumDefinedNumbers(...values: Array<number | undefined>) {
  const present = values.filter((value): value is number => typeof value === 'number' && !Number.isNaN(value))
  if (present.length === 0) {
    return undefined
  }
  return present.reduce((sum, value) => sum + value, 0)
}
