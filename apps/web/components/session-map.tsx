'use client'

import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import {
  ArrowUpDown,
  Clock3,
  FolderOpen,
  GitBranch,
  Layers3,
  PanelsTopLeft,
  Sparkles,
} from 'lucide-react'
import {
  formatTokenUsageInline,
  formatTokenTrackingLabel,
  formatTokenUsageOverview,
  summarizeTurnsTokenUsage,
} from '@/lib/token-usage'
import { cn } from '@/lib/utils'
import { localPathIdentitiesMatch } from '@cchistory/domain'
import type { ProjectIdentity, Session, TokenUsageSummary, UserTurn } from '@/lib/types'
import { formatSourcePlatform, SessionBadge } from './session-badge'

interface SessionMapProps {
  turns: UserTurn[]
  sessionRegistry: Map<string, Session>
  projectRegistry: Map<string, ProjectIdentity>
  selectedTurnId?: string
  onTurnSelect: (turn: UserTurn) => void
  className?: string
  defaultAxisMode?: AxisMode
  fixedAxisMode?: AxisMode
  defaultSortBy?: SessionMapSort
  defaultSortDirection?: SessionMapSortDirection
  showOverview?: boolean
  hideProjectPathWhenRedundant?: boolean
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
  tokenUsage?: TokenUsageSummary
  trackedTokenTurnCount: number
  excludedKnownZeroToken?: number
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
  tokenUsage?: TokenUsageSummary
  trackedTokenTurnCount: number
  excludedKnownZeroToken?: number
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
  row: number
}

type AxisMode = 'shared' | 'session'
type LaneDensity = 'single' | 'standard' | 'dense'
type SessionMapSort = 'recent' | 'created' | 'turns' | 'active' | 'span' | 'tokens' | 'name'
type SessionMapSortDirection = 'asc' | 'desc'

export function SessionMap({
  turns,
  sessionRegistry,
  projectRegistry,
  selectedTurnId,
  onTurnSelect,
  className,
  defaultAxisMode = 'shared',
  fixedAxisMode,
  defaultSortBy = 'recent',
  defaultSortDirection = 'desc',
  showOverview = true,
  hideProjectPathWhenRedundant = false,
}: SessionMapProps) {
  const [axisModeState, setAxisMode] = useState<AxisMode>(fixedAxisMode ?? defaultAxisMode)
  const [sortBy, setSortBy] = useState<SessionMapSort>(defaultSortBy)
  const [sortDirection, setSortDirection] = useState<SessionMapSortDirection>(defaultSortDirection)
  const axisMode = fixedAxisMode ?? axisModeState

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
        const tokenStats = summarizeTurnsTokenUsage(orderedTurns)
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
          tokenUsage: tokenStats.usage,
          trackedTokenTurnCount: tokenStats.trackedTurns,
          excludedKnownZeroToken: tokenStats.excludedKnownZeroToken,
        } satisfies SessionLane
      })
      .sort((left, right) => compareSessionLanes(left, right, sortBy, sortDirection))

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
        const orderedLanes = [...projectLanes].sort((left, right) =>
          compareSessionLanes(left, right, sortBy, sortDirection),
        )
        const tokenStats = summarizeTurnsTokenUsage(orderedLanes.flatMap((lane) => lane.turns))

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
          tokenUsage: tokenStats.usage,
          trackedTokenTurnCount: tokenStats.trackedTurns,
          excludedKnownZeroToken: tokenStats.excludedKnownZeroToken,
        } satisfies SessionGroup
      })
      .sort((left, right) => compareSessionGroups(left, right, sortBy, sortDirection))
  }, [projectRegistry, sessionRegistry, sortBy, sortDirection, turns])

  const overallTokenStats = useMemo(() => summarizeTurnsTokenUsage(turns), [turns])
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
                  label={formatTokenUsageOverview(overallTokenStats.usage, overallTokenStats.trackedTurns, turns.length - (overallTokenStats.excludedKnownZeroToken ?? 0))}
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

            <div className="flex flex-wrap items-center gap-2">
              {!fixedAxisMode && (
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
              )}

              <div className="flex items-center gap-2 border border-border bg-paper px-2 py-1 text-xs text-muted">
                <ArrowUpDown className="h-3.5 w-3.5" />
                <select
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value as SessionMapSort)}
                  aria-label="Sort session map"
                  className="bg-transparent text-xs text-ink focus:outline-none"
                >
                  <option value="recent">Activity</option>
                  <option value="created">Created Time</option>
                  <option value="turns">Turn Count</option>
                  <option value="active">Active Window</option>
                  <option value="span">Session Span</option>
                  <option value="tokens">Token Total</option>
                  <option value="name">Name</option>
                </select>
                <button
                  type="button"
                  onClick={() => setSortDirection((current) => (current === 'desc' ? 'asc' : 'desc'))}
                  aria-label={sortDirection === 'desc' ? 'Switch to ascending order' : 'Switch to descending order'}
                  className="border-l border-border pl-2 mono-text text-[10px] text-ink transition-colors hover:text-muted"
                  title={sortDirection === 'desc' ? 'Descending order' : 'Ascending order'}
                >
                  {sortDirection === 'desc' ? 'DESC' : 'ASC'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      {axisMode === 'shared' && (
        <div className="border-b border-border bg-paper px-4 py-2 text-[10px] text-muted sm:px-6">
          Dual-rail timeline: `ABS` = session placement on the project clock, `REL` = clickable turn windows inside that session.
        </div>
      )}

      <div className="space-y-4 p-4">
        {groups.map((group) => (
          <ProjectGroupSection
            key={group.key}
            group={group}
            axisMode={axisMode}
            selectedTurnId={selectedTurnId}
            onTurnSelect={onTurnSelect}
            hideProjectPathWhenRedundant={hideProjectPathWhenRedundant}
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
  hideProjectPathWhenRedundant,
}: {
  group: SessionGroup
  axisMode: AxisMode
  selectedTurnId?: string
  onTurnSelect: (turn: UserTurn) => void
  hideProjectPathWhenRedundant: boolean
}) {
  const groupTimelineStartMs = group.projectStartedAt.getTime()
  const groupTimelineDurationMs = Math.max(
    group.projectClosedAt.getTime() - group.projectStartedAt.getTime(),
    1,
  )
  const groupTokenTracking = formatTokenTrackingLabel(group.trackedTokenTurnCount, group.turns.length - (group.excludedKnownZeroToken ?? 0))
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
              {group.trackedTokenTurnCount > 0 && (
                <span className="border border-border bg-paper px-2.5 py-1">
                  Tokens {groupTokenTracking}
                </span>
              )}
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
            hideProjectPathWhenRedundant={hideProjectPathWhenRedundant}
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
  hideProjectPathWhenRedundant,
}: {
  lane: SessionLane
  axisMode: AxisMode
  projectTimelineStartMs: number
  projectTimelineDurationMs: number
  selectedTurnId?: string
  onTurnSelect: (turn: UserTurn) => void
  hideProjectPathWhenRedundant: boolean
}) {
  const density = getLaneDensity(lane.turns.length)
  const segmentHeight = getSegmentHeightPx(density)
  const sessionActiveDurationMs = Math.max(
    lane.activeEndedAt.getTime() - lane.activeStartedAt.getTime(),
    1,
  )
  const { segments, rowCount } =
    axisMode === 'session'
      ? buildTurnSegments(lane, lane.activeStartedAt.getTime(), sessionActiveDurationMs, axisMode)
      : { segments: [], rowCount: 1 }
  const chartHeight = axisMode === 'session' ? getChartHeight(density, rowCount) : 0
  const sharedRelativeTrackHeight = segmentHeight + 12
  const sessionSpan =
    axisMode === 'shared'
      ? buildSpanPosition(
          lane.sessionStartedAt.getTime(),
          lane.sessionClosedAt.getTime(),
          projectTimelineStartMs,
          projectTimelineDurationMs,
        )
      : undefined
  const sessionLocalSegments =
    axisMode === 'shared'
      ? buildWindowSegments(lane.turnWindows, lane.activeStartedAt.getTime(), sessionActiveDurationMs)
      : []
  const tokenSummary = formatTokenUsageInline(
    lane.tokenUsage,
    lane.trackedTokenTurnCount,
    lane.turns.length - (lane.excludedKnownZeroToken ?? 0),
  )
  const tokenSummaryText = tokenSummary === 'Tokens unavailable' ? 'Unavailable' : tokenSummary
  const workspacePath = lane.session.working_directory
  const shouldShowWorkspacePath = workspacePath
    ? !hideProjectPathWhenRedundant || !pathsMatch(workspacePath, lane.project?.primary_workspace_path)
    : !lane.project?.primary_workspace_path

  return (
    <div className="border border-border bg-paper p-4">
      <div className="grid gap-4 xl:grid-cols-[15rem_minmax(0,1fr)]">
        <div className="space-y-3 border-b border-dashed border-border/80 pb-4 xl:border-b-0 xl:border-r xl:pb-0 xl:pr-4">
          <div>
            <SessionBadge
              session={lane.session}
              className="max-w-full bg-card px-3 py-1.5"
              showPlatform={false}
              showTurnCount={false}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[10px] stamp-text text-muted">
            <span className="border border-border bg-card px-2 py-1 mono-text">
              {formatSourcePlatform(lane.session.source_platform)}
            </span>
            <span className="border border-border bg-card px-2 py-1">
              {lane.turns.length} turns
            </span>
            {lane.session.model && (
              <span
                className="max-w-full truncate border border-border bg-card px-2 py-1"
                title={lane.session.model}
              >
                {lane.session.model}
              </span>
            )}
          </div>

          <div className="space-y-2">
            <MetricRow label="Active" value={formatDurationCompact(lane.activeDurationMs)} />
            <MetricRow
              label="Span"
              value={formatDurationCompact(lane.sessionClosedAt.getTime() - lane.sessionStartedAt.getTime())}
            />
          </div>

          {shouldShowWorkspacePath && (
            <div className="space-y-1">
              <div className="text-[10px] stamp-text text-muted">Workspace</div>
              <div className="flex items-start gap-2 text-[11px] text-muted">
                <GitBranch className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                <span className={cn(workspacePath ? 'mono-text break-all' : 'italic')}>
                  {workspacePath ?? 'Path unavailable from source'}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] stamp-text text-muted">
            <span>{axisMode === 'shared' ? 'Project-aligned session span' : 'Session-local turn markers'}</span>
            <span>{axisMode === 'shared' ? 'ABS span + REL turn windows' : formatDensityLabel(density)}</span>
          </div>
          {axisMode === 'session' && rowCount > 1 && (
            <div className="text-[10px] text-muted">
              Extra rows only prevent marker overlap. They do not mean turns ran concurrently.
            </div>
          )}

          {axisMode === 'shared' ? (
            <div className="grid gap-2">
              <div className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-3">
                <div className="text-[10px] stamp-text text-muted">ABS</div>
                <div
                  className="relative overflow-hidden border border-border/80 bg-card/70 px-3 py-2"
                  style={{ minHeight: '34px' }}
                >
                  <div className="absolute inset-x-3 top-1/2 border-t border-dashed border-border" />
                  {sessionSpan && (
                    <div
                      className="absolute inset-y-2 rounded-sm border shadow-hard"
                      style={{
                        left: `${sessionSpan.left}%`,
                        width: `${sessionSpan.width}%`,
                        ...buildSessionSpanStyle(lane),
                      }}
                    />
                  )}
                </div>
              </div>

              <div className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-3">
                <div className="text-[10px] stamp-text text-muted">REL</div>
                <div
                  className="relative overflow-hidden border border-border/80 bg-card/70 px-3 py-2"
                  style={{ minHeight: `${sharedRelativeTrackHeight + 8}px` }}
                >
                  <div
                    className="absolute inset-x-3 border-t border-dashed border-border"
                    style={{ top: `${10 + segmentHeight / 2}px` }}
                  />
                  {sessionLocalSegments.map((segment) => {
                    const label = segmentLabel(segment.turn, segment.order, segment.width, lane.turns.length)
                    const title = segmentTitle(segment.turn, segment.order)
                    return (
                      <button
                        key={segment.turn.id}
                        type="button"
                        onClick={() => onTurnSelect(segment.turn)}
                        aria-label={title}
                        title={title}
                        className={cn(
                          'absolute flex items-center justify-center overflow-hidden border px-1.5 text-[10px] stamp-text transition-all',
                          density === 'single' ? 'h-7' : density === 'dense' ? 'h-4' : 'h-5',
                          toneClassName(segment.turn),
                          selectedTurnId === segment.turn.id &&
                            'ring-2 ring-ink ring-offset-2 ring-offset-card',
                        )}
                        style={{
                          top: '10px',
                          left: `${segment.left}%`,
                          width: `${segment.width}%`,
                        }}
                      >
                        {label ? (
                          <span className="truncate">{label}</span>
                        ) : (
                          <span className="h-2 w-2 bg-current" />
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div
              className="relative overflow-hidden border border-border/80 bg-card/70 px-3 py-2"
              style={{ minHeight: `${chartHeight}px` }}
            >
              {Array.from({ length: rowCount }).map((_, index) => (
                <div
                  key={`${lane.session.id}-track-${index}`}
                  className="absolute inset-x-3 border-t border-dashed border-border"
                  style={{ top: `${getSegmentTopPx(index, density) + segmentHeight / 2}px` }}
                />
              ))}

              {segments.map((segment) => {
                const label = segmentLabel(segment.turn, segment.order, segment.width, lane.turns.length)
                const title = segmentTitle(segment.turn, segment.order)
                return (
                  <button
                    key={segment.turn.id}
                    type="button"
                    onClick={() => onTurnSelect(segment.turn)}
                    aria-label={title}
                    title={title}
                    className={cn(
                      'absolute flex items-center justify-center overflow-hidden border px-1.5 text-[10px] stamp-text transition-all',
                      density === 'single' ? 'h-7' : density === 'dense' ? 'h-4' : 'h-5',
                      toneClassName(segment.turn),
                      selectedTurnId === segment.turn.id &&
                        'ring-2 ring-ink ring-offset-2 ring-offset-card',
                    )}
                    style={{
                      top: `${getSegmentTopPx(segment.row, density)}px`,
                      left: `${segment.left}%`,
                      width: `${segment.width}%`,
                      zIndex: rowCount - segment.row,
                    }}
                  >
                    {label ? <span className="truncate">{label}</span> : <span className="h-2 w-2 bg-current" />}
                  </button>
                )
              })}
            </div>
          )}

          <div className="flex flex-wrap items-end justify-between gap-2 text-[10px] text-muted">
            <div className="flex flex-wrap items-center gap-2">
              <span className="border border-border bg-paper px-2.5 py-1">
                {format(lane.activeStartedAt, 'MM-dd HH:mm', { locale: zhCN })} → {format(lane.activeEndedAt, 'MM-dd HH:mm', { locale: zhCN })}
              </span>
              {axisMode === 'shared' && (
                <span className="border border-border bg-paper px-2.5 py-1">
                  Session closes {format(lane.sessionClosedAt, 'MM-dd HH:mm', { locale: zhCN })}
                </span>
              )}
            </div>
            <div className="text-right text-[11px] text-muted">
              <span className="stamp-text">Tokens</span>{' '}
              <span className="mono-text">{tokenSummaryText}</span>
            </div>
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

function buildTurnSegments(
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

function buildWindowSegments(
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
  const minVisibleWidth = 2.4
  const width = Math.max(right - left, minVisibleWidth)
  const adjustedLeft = Math.min(left, Math.max(0, 100 - width))
  return {
    left: adjustedLeft,
    width: Math.min(width, 100 - adjustedLeft),
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

function getChartHeight(density: LaneDensity, rowCount: number) {
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

function getSegmentGapPercent(axisMode: AxisMode) {
  return axisMode === 'shared' ? 0.35 : 0.5
}

function findAvailableRow(left: number, width: number, rowEnds: number[], gapPercent: number) {
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

function getSegmentHeightPx(density: LaneDensity) {
  if (density === 'single') {
    return 28
  }
  if (density === 'dense') {
    return 16
  }
  return 20
}

function getRowGapPx(density: LaneDensity) {
  if (density === 'dense') {
    return 6
  }
  return 8
}

function getSegmentTopPx(row: number, density: LaneDensity) {
  const topPadding = 8
  const segmentHeight = getSegmentHeightPx(density)
  const rowGap = getRowGapPx(density)
  return topPadding + row * (segmentHeight + rowGap)
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

function MetricRow({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="grid grid-cols-[4.25rem_minmax(0,1fr)] gap-2 text-[11px]">
      <span className="stamp-text text-muted">{label}</span>
      <span className="text-text">{value}</span>
    </div>
  )
}

function buildSessionSpanStyle(lane: SessionLane) {
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

function formatDensityLabel(density: LaneDensity) {
  if (density === 'single') {
    return 'single marker'
  }
  if (density === 'dense') {
    return 'dense stack'
  }
  return 'standard markers'
}

function compareSessionLanes(
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

function compareSessionGroups(
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

function compareLaneValue(left: SessionLane, right: SessionLane, sortBy: SessionMapSort) {
  if (sortBy === 'name') {
    return (left.session.title ?? '').localeCompare(right.session.title ?? '', 'zh-Hans-CN')
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

function compareGroupValue(left: SessionGroup, right: SessionGroup, sortBy: SessionMapSort) {
  if (sortBy === 'name') {
    const leftName = left.project?.name ?? 'Unlinked Sessions'
    const rightName = right.project?.name ?? 'Unlinked Sessions'
    return leftName.localeCompare(rightName, 'zh-Hans-CN')
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

function applySortDirection(delta: number, sortDirection: SessionMapSortDirection) {
  return sortDirection === 'asc' ? delta : -delta
}

function getTokenTotal(usage?: TokenUsageSummary) {
  return usage?.total_tokens ?? usage?.output_tokens ?? usage?.input_tokens ?? -1
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

function pathsMatch(left: string | undefined, right: string | undefined) {
  return localPathIdentitiesMatch(left, right)
}
