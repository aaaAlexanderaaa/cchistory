'use client'

import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import {
  Clock3,
  FolderOpen,
  GitBranch,
  Layers3,
  PanelsTopLeft,
  Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ProjectIdentity, Session, UserTurn } from '@/lib/types'
import { SessionBadge } from './session-badge'

interface SessionMapProps {
  turns: UserTurn[]
  sessionRegistry: Map<string, Session>
  projectRegistry: Map<string, ProjectIdentity>
  selectedTurnId?: string
  onTurnSelect: (turn: UserTurn) => void
  className?: string
  defaultAxisMode?: AxisMode
  showOverview?: boolean
}

interface SessionGroup {
  key: string
  project?: ProjectIdentity
  lanes: SessionLane[]
  turns: UserTurn[]
  projectStartedAt: Date
  projectClosedAt: Date
  activeStartedAt: Date
  activeEndedAt: Date
  activeDurationMs: number
  totalTokens?: number
  trackedTokenTurnCount: number
}

interface SessionLane {
  session: Session
  turns: UserTurn[]
  turnWindows: TurnWindow[]
  project?: ProjectIdentity
  sessionStartedAt: Date
  sessionClosedAt: Date
  activeStartedAt: Date
  activeEndedAt: Date
  activeDurationMs: number
  totalTokens?: number
  trackedTokenTurnCount: number
}

interface TurnWindow {
  turn: UserTurn
  order: number
  startMs: number
  endMs: number
}

interface RenderSegment {
  turn: UserTurn
  order: number
  left: number
  width: number
}

type AxisMode = 'shared' | 'session'
type LaneDensity = 'single' | 'standard' | 'dense'

export function SessionMap({
  turns,
  sessionRegistry,
  projectRegistry,
  selectedTurnId,
  onTurnSelect,
  className,
  defaultAxisMode = 'shared',
  showOverview = true,
}: SessionMapProps) {
  const [axisMode, setAxisMode] = useState<AxisMode>(defaultAxisMode)

  const groups = useMemo(() => {
    const turnsBySession = new Map<string, UserTurn[]>()
    for (const turn of turns) {
      const current = turnsBySession.get(turn.session_id)
      if (current) {
        current.push(turn)
      } else {
        turnsBySession.set(turn.session_id, [turn])
      }
    }

    const lanes = [...turnsBySession.entries()]
      .map(([sessionId, sessionTurns]) => {
        const orderedTurns = [...sessionTurns].sort(
          (left, right) => left.created_at.getTime() - right.created_at.getTime(),
        )
        const turnWindows = buildTurnWindows(orderedTurns)
        const session = sessionRegistry.get(sessionId) ?? createSessionFallback(sessionId, orderedTurns)
        const project = resolveSessionProject(session, orderedTurns, projectRegistry)
        const tokenStats = summarizeTokens(orderedTurns)
        const activeStartedAt = turnWindows[0]
          ? new Date(turnWindows[0].startMs)
          : session.created_at
        const activeEndedAt = turnWindows.at(-1)
          ? new Date(turnWindows.at(-1)!.endMs)
          : session.updated_at
        const sessionStartedAt = new Date(
          Math.min(session.created_at.getTime(), activeStartedAt.getTime()),
        )
        const sessionClosedAt = new Date(
          Math.max(session.updated_at.getTime(), activeEndedAt.getTime()),
        )

        return {
          session,
          turns: orderedTurns,
          turnWindows,
          project,
          sessionStartedAt,
          sessionClosedAt,
          activeStartedAt,
          activeEndedAt,
          activeDurationMs: turnWindows.reduce((sum, window) => sum + (window.endMs - window.startMs), 0),
          totalTokens: tokenStats.totalTokens,
          trackedTokenTurnCount: tokenStats.trackedTurns,
        } satisfies SessionLane
      })
      .sort((left, right) => {
        const turnDelta = right.turns.length - left.turns.length
        if (turnDelta !== 0) {
          return turnDelta
        }
        return right.activeEndedAt.getTime() - left.activeEndedAt.getTime()
      })

    const groupsByProject = new Map<string, SessionLane[]>()
    for (const lane of lanes) {
      const key = lane.project?.id ?? '__unlinked__'
      const current = groupsByProject.get(key)
      if (current) {
        current.push(lane)
      } else {
        groupsByProject.set(key, [lane])
      }
    }

    return [...groupsByProject.entries()]
      .map(([key, projectLanes]) => {
        const orderedLanes = [...projectLanes].sort((left, right) => {
          const turnDelta = right.turns.length - left.turns.length
          if (turnDelta !== 0) {
            return turnDelta
          }
          return right.activeEndedAt.getTime() - left.activeEndedAt.getTime()
        })
        const tokenStats = summarizeTokens(orderedLanes.flatMap((lane) => lane.turns))

        return {
          key,
          project: orderedLanes[0]?.project,
          lanes: orderedLanes,
          turns: orderedLanes.flatMap((lane) => lane.turns),
          projectStartedAt: new Date(
            Math.min(...orderedLanes.map((lane) => lane.sessionStartedAt.getTime())),
          ),
          projectClosedAt: new Date(
            Math.max(...orderedLanes.map((lane) => lane.sessionClosedAt.getTime())),
          ),
          activeStartedAt: new Date(
            Math.min(...orderedLanes.map((lane) => lane.activeStartedAt.getTime())),
          ),
          activeEndedAt: new Date(
            Math.max(...orderedLanes.map((lane) => lane.activeEndedAt.getTime())),
          ),
          activeDurationMs: orderedLanes.reduce((sum, lane) => sum + lane.activeDurationMs, 0),
          totalTokens: tokenStats.totalTokens,
          trackedTokenTurnCount: tokenStats.trackedTurns,
        } satisfies SessionGroup
      })
      .sort((left, right) => {
        if (left.project && !right.project) {
          return -1
        }
        if (!left.project && right.project) {
          return 1
        }
        return right.projectClosedAt.getTime() - left.projectClosedAt.getTime()
      })
  }, [projectRegistry, sessionRegistry, turns])

  const overallTokenStats = useMemo(() => summarizeTokens(turns), [turns])
  const overallActiveDurationMs = useMemo(
    () => groups.reduce((sum, group) => sum + group.activeDurationMs, 0),
    [groups],
  )

  if (groups.length === 0) {
    return (
      <div
        className={cn(
          'flex h-full items-center justify-center border border-dashed border-border bg-card',
          className,
        )}
      >
        <div className="text-sm text-muted">No sessions match the current filters.</div>
      </div>
    )
  }

  return (
    <div className={cn('h-full min-h-0 overflow-y-auto border border-border bg-card', className)}>
      <div className="border-b border-border px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="text-[10px] stamp-text text-muted">Session Map</div>
            {showOverview ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <SummaryChip icon={<FolderOpen className="h-3.5 w-3.5" />} label={`${groups.length} project groups`} />
                <SummaryChip icon={<PanelsTopLeft className="h-3.5 w-3.5" />} label={`${countUniqueSessions(turns)} sessions`} />
                <SummaryChip icon={<Layers3 className="h-3.5 w-3.5" />} label={`${turns.length} turns`} />
                <SummaryChip icon={<Clock3 className="h-3.5 w-3.5" />} label={`Active ${formatDurationCompact(overallActiveDurationMs)}`} />
                <SummaryChip
                  icon={<Sparkles className="h-3.5 w-3.5" />}
                  label={formatTokenSummary(overallTokenStats.totalTokens, overallTokenStats.trackedTurns, turns.length)}
                />
              </div>
            ) : (
              <div className="text-xs text-muted">
                {countUniqueSessions(turns)} sessions across {groups.length} project groups
              </div>
            )}
          </div>

          <div className="flex flex-col items-start gap-2 lg:items-end">
            <div className="flex flex-wrap items-center gap-2 text-[10px] stamp-text text-muted">
              <LegendChip tone="committed" label="Committed" />
              <LegendChip tone="candidate" label="Candidate" />
              <LegendChip tone="unlinked" label="Unlinked" />
            </div>

            <div className="flex items-center border border-border bg-paper p-1 text-xs">
              <AxisButton
                active={axisMode === 'shared'}
                title="Align sessions on a project-wide clock"
                onClick={() => setAxisMode('shared')}
              >
                Project Time
              </AxisButton>
              <AxisButton
                active={axisMode === 'session'}
                title="Show session-local timing inside each session"
                onClick={() => setAxisMode('session')}
              >
                Session Time
              </AxisButton>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {groups.map((group) => (
          <ProjectGroupSection
            key={group.key}
            group={group}
            axisMode={axisMode}
            selectedTurnId={selectedTurnId}
            onTurnSelect={onTurnSelect}
          />
        ))}
      </div>
    </div>
  )
}

function ProjectGroupSection({
  group,
  axisMode,
  selectedTurnId,
  onTurnSelect,
}: {
  group: SessionGroup
  axisMode: AxisMode
  selectedTurnId?: string
  onTurnSelect: (turn: UserTurn) => void
}) {
  const groupTimelineStartMs = group.projectStartedAt.getTime()
  const groupTimelineDurationMs = Math.max(
    group.projectClosedAt.getTime() - group.projectStartedAt.getTime(),
    1,
  )
  const tickDates =
    axisMode === 'shared'
      ? buildAxisTicks(group.projectStartedAt, group.projectClosedAt)
      : undefined

  return (
    <section className="overflow-hidden border border-border bg-card shadow-hard">
      <div className="border-b border-border px-4 py-3 sm:px-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {group.project ? (
                <span
                  className="inline-flex items-center gap-1.5 border px-3 py-1 text-xs font-medium"
                  style={{
                    borderColor: `${group.project.color}38`,
                    backgroundColor: `${group.project.color}14`,
                    color: group.project.color,
                  }}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  {group.project.name}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 border border-border bg-paper px-3 py-1 text-xs font-medium text-ink">
                  <FolderOpen className="h-3.5 w-3.5" />
                  Unlinked Sessions
                </span>
              )}

              {group.project?.linkage_state === 'candidate' && (
                <LegendChip tone="candidate" label={`Project ${(group.project.confidence * 100).toFixed(0)}%`} />
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted">
              <span className="border border-border bg-paper px-2.5 py-1">
                {group.lanes.length} sessions
              </span>
              <span className="border border-border bg-paper px-2.5 py-1">
                {group.turns.length} turns
              </span>
              <span className="border border-border bg-paper px-2.5 py-1">
                Active {formatDurationCompact(group.activeDurationMs)}
              </span>
              <span className="border border-border bg-paper px-2.5 py-1">
                {formatTokenSummary(group.totalTokens, group.trackedTokenTurnCount, group.turns.length)}
              </span>
            </div>
          </div>

          <div className="text-xs text-muted">
            {axisMode === 'shared'
              ? `${format(group.projectStartedAt, 'MM-dd HH:mm', { locale: zhCN })} → ${format(group.projectClosedAt, 'MM-dd HH:mm', { locale: zhCN })}`
              : `${format(group.activeStartedAt, 'MM-dd HH:mm', { locale: zhCN })} → ${format(group.activeEndedAt, 'MM-dd HH:mm', { locale: zhCN })}`}
          </div>
        </div>
      </div>

      {tickDates && (
        <div className="hidden border-b border-border px-4 py-2 text-[10px] stamp-text text-muted xl:block">
          <div className="grid grid-cols-[16rem_minmax(0,1fr)] gap-4">
            <div />
            <div className="grid grid-cols-5 gap-2">
              {tickDates.map((tick, index) => (
                <span
                  key={`${group.key}-tick-${index}`}
                  className={cn(
                    index === 0 && 'text-left',
                    index > 0 && index < tickDates.length - 1 && 'text-center',
                    index === tickDates.length - 1 && 'text-right',
                  )}
                >
                  {format(tick, 'MM-dd HH:mm', { locale: zhCN })}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3 p-4">
        {group.lanes.map((lane) => (
          <SessionLaneRow
            key={lane.session.id}
            lane={lane}
            axisMode={axisMode}
            projectTimelineStartMs={groupTimelineStartMs}
            projectTimelineDurationMs={groupTimelineDurationMs}
            selectedTurnId={selectedTurnId}
            onTurnSelect={onTurnSelect}
          />
        ))}
      </div>
    </section>
  )
}

function SessionLaneRow({
  lane,
  axisMode,
  projectTimelineStartMs,
  projectTimelineDurationMs,
  selectedTurnId,
  onTurnSelect,
}: {
  lane: SessionLane
  axisMode: AxisMode
  projectTimelineStartMs: number
  projectTimelineDurationMs: number
  selectedTurnId?: string
  onTurnSelect: (turn: UserTurn) => void
}) {
  const density = getLaneDensity(lane.turns.length)
  const timelineStartMs =
    axisMode === 'shared'
      ? projectTimelineStartMs
      : lane.activeStartedAt.getTime()
  const totalDurationMs =
    axisMode === 'shared'
      ? projectTimelineDurationMs
      : Math.max(lane.activeEndedAt.getTime() - lane.activeStartedAt.getTime(), 1)
  const segments = buildTurnSegments(lane, timelineStartMs, totalDurationMs, axisMode)
  const chartHeight = getChartHeight(density)
  const sessionSpan =
    axisMode === 'shared'
      ? buildSpanPosition(
          lane.sessionStartedAt.getTime(),
          lane.sessionClosedAt.getTime(),
          timelineStartMs,
          totalDurationMs,
        )
      : undefined
  const showPath = density !== 'single' && lane.session.working_directory

  return (
    <div className="border border-border bg-paper p-3">
      <div className="grid gap-3 xl:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="space-y-2">
          <div className="flex flex-wrap items-start gap-2">
            <SessionBadge session={lane.session} className="max-w-full bg-card px-3 py-1.5" />
            <span className="inline-flex items-center gap-1.5 border border-border bg-card px-2.5 py-1 text-[10px] stamp-text text-muted">
              {formatPlatformLabel(lane.session.source_platform)}
            </span>
            <SessionScaleBadge density={density} turns={lane.turns.length} />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted">
            <span className="border border-border bg-card px-2.5 py-1">
              Active {formatDurationCompact(lane.activeDurationMs)}
            </span>
            <span className="border border-border bg-card px-2.5 py-1">
              Span {formatDurationCompact(lane.sessionClosedAt.getTime() - lane.sessionStartedAt.getTime())}
            </span>
            <span className="border border-border bg-card px-2.5 py-1">
              {formatTokenSummary(lane.totalTokens, lane.trackedTokenTurnCount, lane.turns.length)}
            </span>
          </div>

          {showPath ? (
            <div className="flex items-start gap-2 text-[10px] text-muted">
              <GitBranch className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span className="mono-text break-all">{lane.session.working_directory}</span>
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] stamp-text text-muted">
            <span>{axisMode === 'shared' ? 'Project time alignment' : 'Session-local time'}</span>
            <span>{density === 'single' ? 'Single-turn lane' : density === 'dense' ? 'Dense lane' : 'Standard lane'}</span>
          </div>

          <div
            className="relative overflow-hidden border border-border bg-card"
            style={{ minHeight: `${chartHeight}px` }}
          >
            <div className="absolute inset-x-3 top-1/2 h-px -translate-y-1/2 bg-border" />

            {axisMode === 'shared' && sessionSpan && (
              <div
                className="absolute inset-y-3 border border-dashed border-border bg-paper/70"
                style={{
                  left: `${sessionSpan.left}%`,
                  width: `${sessionSpan.width}%`,
                }}
              />
            )}

            {segments.map((segment) => {
              const label = segmentLabel(segment.turn, segment.order, segment.width, lane.turns.length)
              return (
                <button
                  key={segment.turn.id}
                  type="button"
                  onClick={() => onTurnSelect(segment.turn)}
                  title={segmentTitle(segment.turn, segment.order)}
                  className={cn(
                    'absolute top-1/2 flex -translate-y-1/2 items-center justify-center overflow-hidden border px-1.5 text-[10px] stamp-text transition-all',
                    density === 'single' ? 'h-7' : density === 'dense' ? 'h-4' : 'h-5',
                    toneClassName(segment.turn),
                    selectedTurnId === segment.turn.id &&
                      'ring-2 ring-ink ring-offset-2 ring-offset-card',
                  )}
                  style={{
                    left: `${segment.left}%`,
                    width: `${segment.width}%`,
                    zIndex: segment.order + 1,
                  }}
                >
                  {label ? <span className="truncate">{label}</span> : <span className="h-2 w-2 bg-current" />}
                </button>
              )
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted">
            <span className="border border-border bg-paper px-2.5 py-1">
              {format(lane.activeStartedAt, 'MM-dd HH:mm', { locale: zhCN })} → {format(lane.activeEndedAt, 'MM-dd HH:mm', { locale: zhCN })}
            </span>
            {axisMode === 'shared' && (
              <span className="border border-border bg-paper px-2.5 py-1">
                Session closes {format(lane.sessionClosedAt, 'MM-dd HH:mm', { locale: zhCN })}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function AxisButton({
  active,
  children,
  title,
  onClick,
}: {
  active: boolean
  children: string
  title: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'px-3 py-1.5 transition-colors',
        active ? 'bg-ink text-card' : 'text-muted hover:bg-card hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

function SummaryChip({
  icon,
  label,
}: {
  icon: ReactNode
  label: string
}) {
  return (
    <span className="inline-flex items-center gap-1.5 border border-border bg-paper px-2.5 py-1">
      {icon}
      {label}
    </span>
  )
}

function LegendChip({
  tone,
  label,
}: {
  tone: 'committed' | 'candidate' | 'unlinked'
  label: string
}) {
  return (
    <span
      className={cn(
        'border px-2.5 py-1',
        tone === 'committed' && 'border-success/30 bg-success/10 text-success',
        tone === 'candidate' && 'border-candidate/30 bg-candidate/10 text-candidate',
        tone === 'unlinked' && 'border-border bg-paper text-muted',
      )}
    >
      {label}
    </span>
  )
}

function SessionScaleBadge({
  density,
  turns,
}: {
  density: LaneDensity
  turns: number
}) {
  const label =
    density === 'single'
      ? 'Single turn'
      : density === 'dense'
        ? `${turns} turns · dense`
        : `${turns} turns`

  return (
    <span className="inline-flex items-center gap-1.5 border border-border bg-card px-2.5 py-1 text-[10px] text-muted">
      <Layers3 className="h-3 w-3" />
      {label}
    </span>
  )
}

function buildTurnSegments(
  lane: SessionLane,
  timelineStartMs: number,
  totalDurationMs: number,
  axisMode: AxisMode,
): RenderSegment[] {
  const turnCount = lane.turnWindows.length
  const minWidth =
    axisMode === 'shared'
      ? getSharedModeWidthPercent(turnCount)
      : getSessionModeWidthPercent(turnCount)
  return lane.turnWindows.map((window) => {
    const rawLeft = ((window.startMs - timelineStartMs) / totalDurationMs) * 100
    const rawRight = ((window.endMs - timelineStartMs) / totalDurationMs) * 100
    const actualLeft = clampPercent(rawLeft)
    const actualRight = clampPercent(rawRight)
    const actualWidth = Math.max(actualRight - actualLeft, 0.4)
    const width = clampPercent(Math.max(actualWidth, minWidth))
    const center = actualLeft + actualWidth / 2
    const centeredLeft = clampPercent(center - width / 2)
    const left = Math.min(centeredLeft, Math.max(0, 100 - width))

    return {
      turn: window.turn,
      order: window.order,
      left,
      width: Math.min(width, 100 - left),
    }
  })
}

function buildTurnWindows(turns: UserTurn[]): TurnWindow[] {
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

function buildSpanPosition(
  startedAtMs: number,
  endedAtMs: number,
  timelineStartMs: number,
  totalDurationMs: number,
) {
  const left = clampPercent(((startedAtMs - timelineStartMs) / totalDurationMs) * 100)
  const right = clampPercent(((endedAtMs - timelineStartMs) / totalDurationMs) * 100)
  const width = Math.max(right - left, 1.4)
  return {
    left,
    width: Math.min(width, 100 - left),
  }
}

function buildAxisTicks(startedAt: Date, endedAt: Date) {
  const startMs = startedAt.getTime()
  const totalMs = Math.max(endedAt.getTime() - startMs, 1)

  return [0, 0.25, 0.5, 0.75, 1].map(
    (fraction) => new Date(startMs + totalMs * fraction),
  )
}

function resolveSessionProject(
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

function createSessionFallback(sessionId: string, turns: UserTurn[]): Session {
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

function summarizeTokens(turns: UserTurn[]) {
  let totalTokens = 0
  let trackedTurns = 0

  for (const turn of turns) {
    if (typeof turn.context_summary.total_tokens === 'number') {
      totalTokens += turn.context_summary.total_tokens
      trackedTurns += 1
    }
  }

  return {
    totalTokens: trackedTurns > 0 ? totalTokens : undefined,
    trackedTurns,
  }
}

function segmentLabel(turn: UserTurn, order: number, width: number, totalTurns: number) {
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

function segmentTitle(turn: UserTurn, order: number) {
  return `T${order + 1} · ${turn.canonical_text}`
}

function toneClassName(turn: UserTurn) {
  switch (turn.link_state) {
    case 'committed':
      return 'border-success/35 bg-success/15 text-success hover:bg-success/20'
    case 'candidate':
      return 'border-candidate/35 bg-candidate/15 text-candidate hover:bg-candidate/20'
    case 'unlinked':
      return 'border-border bg-paper text-muted hover:border-ink hover:text-ink'
  }
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(100, value))
}

function getLaneDensity(turnCount: number): LaneDensity {
  if (turnCount <= 1) {
    return 'single'
  }
  if (turnCount >= 12) {
    return 'dense'
  }
  return 'standard'
}

function getChartHeight(density: LaneDensity) {
  if (density === 'single') {
    return 52
  }
  if (density === 'dense') {
    return 72
  }
  return 60
}

function getSharedModeWidthPercent(turnCount: number) {
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

function getSessionModeWidthPercent(turnCount: number) {
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

function formatDurationCompact(durationMs: number) {
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

function formatTokenValue(totalTokens?: number) {
  if (totalTokens === undefined) {
    return 'n/a'
  }
  return new Intl.NumberFormat('en-US').format(totalTokens)
}

function formatTokenSummary(totalTokens: number | undefined, trackedTurns: number, totalTurns: number) {
  if (totalTokens === undefined) {
    return 'Tokens unavailable'
  }
  if (trackedTurns === totalTurns) {
    return `${formatTokenValue(totalTokens)} tokens`
  }
  return `${formatTokenValue(totalTokens)} tokens on ${trackedTurns}/${totalTurns} turns`
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value
  }
  return `${value.slice(0, maxLength - 1).trimEnd()}…`
}

function countUniqueSessions(turns: UserTurn[]) {
  return new Set(turns.map((turn) => turn.session_id)).size
}

function formatPlatformLabel(platform: Session['source_platform']) {
  switch (platform) {
    case 'claude_code':
      return 'Claude'
    case 'cursor':
      return 'Cursor'
    case 'factory_droid':
      return 'Droid'
    case 'antigravity':
      return 'Antigravity'
    case 'amp':
      return 'AMP'
    case 'openclaw':
      return 'OpenClaw'
    case 'opencode':
      return 'OpenCode'
    case 'lobechat':
      return 'LobeChat'
    case 'chatgpt':
      return 'ChatGPT'
    default:
      return platform.replace(/_/g, ' ')
  }
}
