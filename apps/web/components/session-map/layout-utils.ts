import { localPathIdentitiesMatch } from '@cchistory/presentation'
import type { ProjectIdentity, Session, UserTurn } from '@/lib/types'
import type { AxisMode, LaneDensity, RenderSegment, SessionLane, TurnWindow } from './types'

export function buildTurnSegments(
  lane: SessionLane,
  timelineStartMs: number,
  totalDurationMs: number,
  axisMode: AxisMode,
): { segments: RenderSegment[]; rowCount: number } {
  const turnCount = lane.turnWindows.length
  const minWidth =
    axisMode === 'shared'
      ? getSharedModeWidthPercent(turnCount)
      : getSessionModeWidthPercent(turnCount)
  const rowGapPercent = getSegmentGapPercent(axisMode)
  const rowEnds: number[] = []

  const segments = lane.turnWindows.map((window) => {
    const markerCenter = clampPercent(((window.startMs - timelineStartMs) / totalDurationMs) * 100)
    const width = Math.min(minWidth, 100)
    const centeredLeft = clampPercent(markerCenter - width / 2)
    const left = Math.min(centeredLeft, Math.max(0, 100 - width))
    const row = findAvailableRow(left, width, rowEnds, rowGapPercent)

    return {
      turn: window.turn,
      order: window.order,
      left,
      width: Math.min(width, 100 - left),
      row,
    }
  })

  return {
    segments,
    rowCount: Math.max(1, rowEnds.length),
  }
}

export function buildWindowSegments(
  turnWindows: TurnWindow[],
  timelineStartMs: number,
  totalDurationMs: number,
): RenderSegment[] {
  return turnWindows.map((window) => {
    const left = clampPercent(((window.startMs - timelineStartMs) / totalDurationMs) * 100)
    const right = clampPercent(((window.endMs - timelineStartMs) / totalDurationMs) * 100)
    const width = Math.max(0.15, right - left)

    return {
      turn: window.turn,
      order: window.order,
      left,
      width: Math.min(width, 100 - left),
      row: 0,
    }
  })
}

export function buildTurnWindows(turns: UserTurn[]): TurnWindow[] {
  return turns.map((turn, index) => {
    const startMs = turn.created_at.getTime()
    const nextStartMs = turns[index + 1]?.created_at.getTime()
    const naturalEndMs = Math.max(turn.last_context_activity_at.getTime(), startMs + 1)
    const boundedEndMs = nextStartMs ? Math.min(naturalEndMs, nextStartMs - 1) : naturalEndMs
    const endMs = Math.max(startMs + 1, boundedEndMs)

    return {
      turn,
      order: index,
      startMs,
      endMs,
    }
  })
}

export function buildSpanPosition(
  startedAtMs: number,
  endedAtMs: number,
  timelineStartMs: number,
  totalDurationMs: number,
) {
  const left = clampPercent(((startedAtMs - timelineStartMs) / totalDurationMs) * 100)
  const right = clampPercent(((endedAtMs - timelineStartMs) / totalDurationMs) * 100)
  const minVisibleWidth = 2.4
  const width = Math.max(right - left, minVisibleWidth)
  const adjustedLeft = Math.min(left, Math.max(0, 100 - width))
  return {
    left: adjustedLeft,
    width: Math.min(width, 100 - adjustedLeft),
  }
}

export function buildAxisTicks(startedAt: Date, endedAt: Date) {
  const startMs = startedAt.getTime()
  const totalMs = Math.max(endedAt.getTime() - startMs, 1)

  return [0, 0.25, 0.5, 0.75, 1].map(
    (fraction) => new Date(startMs + totalMs * fraction),
  )
}

export function resolveSessionProject(
  session: Session,
  turns: UserTurn[],
  projectRegistry: Map<string, ProjectIdentity>,
): ProjectIdentity | undefined {
  if (session.primary_project_id) {
    return projectRegistry.get(session.primary_project_id)
  }

  const committedProjectId = turns.find((turn) => turn.link_state === 'committed' && turn.project_id)?.project_id
  const fallbackProjectId = committedProjectId ?? turns.find((turn) => turn.project_id)?.project_id
  return fallbackProjectId ? projectRegistry.get(fallbackProjectId) : undefined
}

export function createSessionFallback(sessionId: string, turns: UserTurn[]): Session {
  const firstTurn = turns[0]
  const lastTurn = turns[turns.length - 1]

  return {
    id: sessionId,
    source_id: firstTurn?.source_id ?? 'unknown',
    source_platform: 'other',
    host_id: 'unknown',
    title: `Session ${sessionId.slice(0, 8)}`,
    created_at: firstTurn?.created_at ?? new Date(),
    updated_at: lastTurn?.last_context_activity_at ?? firstTurn?.created_at ?? new Date(),
    turn_count: turns.length,
    sync_axis: 'current',
  }
}

export function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(100, value))
}

export function findAvailableRow(left: number, width: number, rowEnds: number[], gapPercent: number) {
  const segmentEnd = left + width

  for (let row = 0; row < rowEnds.length; row += 1) {
    if (left >= rowEnds[row]! + gapPercent) {
      rowEnds[row] = segmentEnd
      return row
    }
  }

  rowEnds.push(segmentEnd)
  return rowEnds.length - 1
}

export function getLaneDensity(turnCount: number): LaneDensity {
  if (turnCount <= 1) {
    return 'single'
  }
  if (turnCount >= 12) {
    return 'dense'
  }
  return 'standard'
}

export function getChartHeight(density: LaneDensity, rowCount: number) {
  const segmentHeight = getSegmentHeightPx(density)
  const rowGap = getRowGapPx(density)
  const verticalPadding = 16
  const stackedHeight = verticalPadding + rowCount * segmentHeight + Math.max(0, rowCount - 1) * rowGap

  if (density === 'single') {
    return Math.max(52, stackedHeight)
  }
  if (density === 'dense') {
    return Math.max(72, stackedHeight)
  }
  return Math.max(60, stackedHeight)
}

export function getSharedModeWidthPercent(turnCount: number) {
  if (turnCount <= 1) {
    return 24
  }
  if (turnCount <= 4) {
    return 7
  }
  if (turnCount <= 10) {
    return 3
  }
  if (turnCount <= 20) {
    return 1.8
  }
  return 1.1
}

export function getSessionModeWidthPercent(turnCount: number) {
  if (turnCount <= 1) {
    return 24
  }
  if (turnCount <= 4) {
    return 10
  }
  if (turnCount <= 10) {
    return 5.5
  }
  if (turnCount <= 20) {
    return 2.8
  }
  return 1.4
}

export function getSegmentGapPercent(axisMode: AxisMode) {
  return axisMode === 'shared' ? 0.35 : 0.5
}

export function getSegmentHeightPx(density: LaneDensity) {
  if (density === 'single') {
    return 28
  }
  if (density === 'dense') {
    return 16
  }
  return 20
}

export function getRowGapPx(density: LaneDensity) {
  if (density === 'dense') {
    return 6
  }
  return 8
}

export function getSegmentTopPx(row: number, density: LaneDensity) {
  const topPadding = 8
  const segmentHeight = getSegmentHeightPx(density)
  const rowGap = getRowGapPx(density)
  return topPadding + row * (segmentHeight + rowGap)
}

export function segmentLabel(turn: UserTurn, order: number, width: number, totalTurns: number) {
  if (totalTurns === 1) {
    return truncate(turn.canonical_text, 28)
  }

  if (width >= 12) {
    return truncate(turn.canonical_text, 18)
  }

  if (width >= 4 || totalTurns <= 8) {
    return `T${order + 1}`
  }

  return ''
}

export function segmentTitle(turn: UserTurn, order: number) {
  return `T${order + 1} · ${turn.canonical_text}`
}

export function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value
  }
  return `${value.slice(0, maxLength - 1).trimEnd()}…`
}

export function countUniqueSessions(turns: UserTurn[]) {
  return new Set(turns.map((turn) => turn.session_id)).size
}

export function pathsMatch(left: string | undefined, right: string | undefined) {
  return localPathIdentitiesMatch(left, right)
}

export function formatDurationCompact(durationMs: number) {
  const totalMinutes = Math.max(1, Math.round(durationMs / 60000))
  if (totalMinutes < 60) {
    return `${totalMinutes}m`
  }

  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours < 24) {
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
  }

  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return remainingHours === 0 ? `${days}d` : `${days}d ${remainingHours}h`
}

export function formatDensityLabel(density: LaneDensity) {
  if (density === 'single') {
    return 'single marker'
  }
  if (density === 'dense') {
    return 'dense stack'
  }
  return 'standard markers'
}

export function toneClassName(turn: UserTurn) {
  switch (turn.link_state) {
    case 'committed':
      return 'border-success/35 bg-success/15 text-success hover:bg-success/20'
    case 'candidate':
      return 'border-candidate/35 bg-candidate/15 text-candidate hover:bg-candidate/20'
    case 'unlinked':
      return 'border-border bg-paper text-muted hover:border-ink hover:text-ink'
  }
}

export function buildSessionSpanStyle(lane: SessionLane) {
  if (lane.project?.color) {
    return {
      borderColor: `${lane.project.color}70`,
      backgroundColor: `${lane.project.color}24`,
    }
  }

  return {
    borderColor: 'rgb(95 92 87 / 0.55)',
    backgroundColor: 'rgb(95 92 87 / 0.18)',
  }
}
