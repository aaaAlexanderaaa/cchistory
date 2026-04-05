import type { SessionGroup, SessionLane, SessionMapSort, SessionMapSortDirection } from './types'
import type { TokenUsageSummary } from '@/lib/types'

export function compareSessionLanes(
  left: SessionLane,
  right: SessionLane,
  sortBy: SessionMapSort,
  sortDirection: SessionMapSortDirection,
) {
  const primaryDelta = compareLaneValue(left, right, sortBy)
  if (primaryDelta !== 0) {
    return applySortDirection(primaryDelta, sortDirection)
  }

  const fallbackDelta = left.turns.length - right.turns.length
  if (fallbackDelta !== 0) {
    return applySortDirection(fallbackDelta, sortDirection)
  }

  return applySortDirection(left.activeEndedAt.getTime() - right.activeEndedAt.getTime(), sortDirection)
}

export function compareSessionGroups(
  left: SessionGroup,
  right: SessionGroup,
  sortBy: SessionMapSort,
  sortDirection: SessionMapSortDirection,
) {
  if (left.project && !right.project) {
    return -1
  }
  if (!left.project && right.project) {
    return 1
  }

  const primaryDelta = compareGroupValue(left, right, sortBy)
  if (primaryDelta !== 0) {
    return applySortDirection(primaryDelta, sortDirection)
  }

  const fallbackDelta = left.turns.length - right.turns.length
  if (fallbackDelta !== 0) {
    return applySortDirection(fallbackDelta, sortDirection)
  }

  return applySortDirection(left.projectClosedAt.getTime() - right.projectClosedAt.getTime(), sortDirection)
}

export function compareLaneValue(left: SessionLane, right: SessionLane, sortBy: SessionMapSort) {
  if (sortBy === 'name') {
    return (left.session.title ?? '').localeCompare(right.session.title ?? '')
  }
  if (sortBy === 'created') {
    return left.sessionStartedAt.getTime() - right.sessionStartedAt.getTime()
  }
  if (sortBy === 'turns') {
    return left.turns.length - right.turns.length
  }
  if (sortBy === 'active') {
    return left.activeDurationMs - right.activeDurationMs
  }
  if (sortBy === 'span') {
    return (
      left.sessionClosedAt.getTime() -
      left.sessionStartedAt.getTime() -
      (right.sessionClosedAt.getTime() - right.sessionStartedAt.getTime())
    )
  }
  if (sortBy === 'tokens') {
    return getTokenTotal(left.tokenUsage) - getTokenTotal(right.tokenUsage)
  }
  return left.activeEndedAt.getTime() - right.activeEndedAt.getTime()
}

export function compareGroupValue(left: SessionGroup, right: SessionGroup, sortBy: SessionMapSort) {
  if (sortBy === 'name') {
    const leftName = left.project?.name ?? 'Unlinked Sessions'
    const rightName = right.project?.name ?? 'Unlinked Sessions'
    return leftName.localeCompare(rightName)
  }
  if (sortBy === 'created') {
    return left.projectStartedAt.getTime() - right.projectStartedAt.getTime()
  }
  if (sortBy === 'turns') {
    return left.turns.length - right.turns.length
  }
  if (sortBy === 'active') {
    return left.activeDurationMs - right.activeDurationMs
  }
  if (sortBy === 'span') {
    return (
      left.projectClosedAt.getTime() -
      left.projectStartedAt.getTime() -
      (right.projectClosedAt.getTime() - right.projectStartedAt.getTime())
    )
  }
  if (sortBy === 'tokens') {
    return getTokenTotal(left.tokenUsage) - getTokenTotal(right.tokenUsage)
  }
  return left.projectClosedAt.getTime() - right.projectClosedAt.getTime()
}

export function applySortDirection(delta: number, sortDirection: SessionMapSortDirection) {
  return sortDirection === 'asc' ? delta : -delta
}

export function getTokenTotal(usage?: TokenUsageSummary) {
  return usage?.total_tokens ?? usage?.output_tokens ?? usage?.input_tokens ?? -1
}
