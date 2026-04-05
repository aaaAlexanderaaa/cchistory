'use client'

import { format } from 'date-fns'
import { GitBranch } from 'lucide-react'
import { formatTokenUsageInline } from '@/lib/token-usage'
import { cn } from '@/lib/utils'
import type { UserTurn } from '@/lib/types'
import { formatSourcePlatform, SessionBadge } from '../session-badge'
import type { AxisMode, SessionLane } from './types'
import {
  buildSessionSpanStyle,
  buildTurnSegments,
  buildWindowSegments,
  buildSpanPosition,
  formatDensityLabel,
  formatDurationCompact,
  getChartHeight,
  getLaneDensity,
  getSegmentHeightPx,
  getSegmentTopPx,
  pathsMatch,
  segmentLabel,
  segmentTitle,
  toneClassName,
} from './layout-utils'
import { MetricRow } from './ui-atoms'

export function SessionLaneRow({
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
                {format(lane.activeStartedAt, 'MM-dd HH:mm')} → {format(lane.activeEndedAt, 'MM-dd HH:mm')}
              </span>
              {axisMode === 'shared' && (
                <span className="border border-border bg-paper px-2.5 py-1">
                  Session closes {format(lane.sessionClosedAt, 'MM-dd HH:mm')}
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
