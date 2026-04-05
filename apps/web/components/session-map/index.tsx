'use client'

import { useMemo, useState } from 'react'
import {
  ArrowUpDown,
  Clock3,
  FolderOpen,
  Layers3,
  PanelsTopLeft,
  Sparkles,
} from 'lucide-react'
import {
  formatTokenUsageOverview,
  summarizeTurnsTokenUsage,
} from '@/lib/token-usage'
import { cn } from '@/lib/utils'
import type { UserTurn } from '@/lib/types'
import type { SessionLane, SessionGroup, SessionMapProps, AxisMode, SessionMapSort, SessionMapSortDirection } from './types'
import {
  buildTurnWindows,
  countUniqueSessions,
  createSessionFallback,
  formatDurationCompact,
  resolveSessionProject,
} from './layout-utils'
import { compareSessionLanes, compareSessionGroups } from './sort-utils'
import { AxisButton, LegendChip, SummaryChip } from './ui-atoms'
import { ProjectGroupSection } from './project-group-section'

export type { SessionMapProps }

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
