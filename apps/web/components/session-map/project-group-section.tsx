'use client'

import { format } from 'date-fns'
import { FolderOpen } from 'lucide-react'
import { formatTokenTrackingLabel } from '@/lib/token-usage'
import { cn } from '@/lib/utils'
import type { UserTurn } from '@/lib/types'
import type { AxisMode, SessionGroup } from './types'
import { buildAxisTicks, formatDurationCompact } from './layout-utils'
import { LegendChip } from './ui-atoms'
import { SessionLaneRow } from './session-lane-row'

export function ProjectGroupSection({
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
              ? `${format(group.projectStartedAt, 'MM-dd HH:mm')} → ${format(group.projectClosedAt, 'MM-dd HH:mm')}`
              : `${format(group.activeStartedAt, 'MM-dd HH:mm')} → ${format(group.activeEndedAt, 'MM-dd HH:mm')}`}
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
                  {format(tick, 'MM-dd HH:mm')}
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
