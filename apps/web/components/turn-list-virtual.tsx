'use client'

import { useRef, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn, formatAbsoluteDateTime, formatRelativeTime } from '@/lib/utils'
import type { UserTurn, Session, ProjectIdentity } from '@/lib/types'
import { MaskedContentPreview } from './masked-content'
import { 
  MessageSquare, 
  Wrench, 
  AlertCircle, 
  Flag,
  ChevronRight,
  GitCommit,
  HelpCircle,
  Link2Off,
  PanelsTopLeft,
} from 'lucide-react'
interface TurnListVirtualProps {
  turns: UserTurn[]
  selectedTurnId?: string
  onTurnSelect: (turn: UserTurn) => void
  getSession: (sessionId: string) => Session | undefined
  getProject: (projectId: string) => ProjectIdentity | undefined
  className?: string
}

/**
 * TurnListVirtual - Virtualized list of UserTurns
 * Uses @tanstack/react-virtual for efficient rendering of large lists
 */
export function TurnListVirtual({
  turns,
  selectedTurnId,
  onTurnSelect,
  getSession,
  getProject,
  className,
}: TurnListVirtualProps) {
  const parentRef = useRef<HTMLDivElement>(null)

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: turns.length,
    getScrollElement: () => parentRef.current,
    estimateSize: useCallback(() => 118, []),
    measureElement:
      typeof window !== 'undefined'
        ? (element) => element?.getBoundingClientRect().height ?? 118
        : undefined,
    overscan: 5, // Render 5 extra items above/below viewport
  })
  
  const virtualItems = virtualizer.getVirtualItems()
  
  if (turns.length === 0) {
    return (
      <div className={cn('flex items-center justify-center h-full text-muted', className)}>
        <div className="text-center">
          <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No turns found</p>
        </div>
      </div>
    )
  }
  
  return (
    <div 
      ref={parentRef} 
      className={cn('h-full overflow-auto', className)}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualRow) => {
          const turn = turns[virtualRow.index]
          const session = getSession(turn.session_id)
          const project = turn.project_id ? getProject(turn.project_id) : undefined
          
          return (
            <div
              key={turn.id}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <TurnListItem
                turn={turn}
                session={session}
                project={project}
                isSelected={turn.id === selectedTurnId}
                onClick={() => onTurnSelect(turn)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// =============================================================================
// Turn List Item
// =============================================================================

interface TurnListItemProps {
  turn: UserTurn
  session?: Session
  project?: ProjectIdentity
  isSelected: boolean
  onClick: () => void
}

function TurnListItem({ turn, session, project, isSelected, onClick }: TurnListItemProps) {
  const { context_summary } = turn
  
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full border-b border-border px-4 py-3.5 text-left transition-colors sm:px-5',
        isSelected 
          ? 'border-l-4 border-l-accent bg-accent/5'
          : 'border-l-4 border-l-transparent hover:bg-surface-hover',
        turn.value_axis === 'archived' && 'opacity-60'
      )}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <LinkStateBadge state={turn.link_state} confidence={turn.project_confidence} />
          {project && (
            <span
              className="max-w-full truncate px-1.5 py-0.5 text-[10px] stamp-text"
              style={{
                backgroundColor: `${project.color}15`,
                color: project.color,
              }}
            >
              {project.name}
            </span>
          )}
          {turn.is_flagged && <Flag className="w-3 h-3 text-warning" />}
          {turn.user_messages.length > 1 && (
            <span className="text-[10px] stamp-text text-muted">
              {turn.user_messages.length} msgs
            </span>
          )}
        </div>

        <MaskedContentPreview
          segments={turn.display_segments}
          maxLength={220}
          className="line-clamp-2 text-[15px] font-medium leading-6 text-ink"
        />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
          <span>{formatRelativeTime(turn.created_at)}</span>
          <span className="hidden mono-text lg:inline">{formatAbsoluteDateTime(turn.created_at)}</span>
          <span className="flex items-center gap-1">
            <MessageSquare className="w-3 h-3" />
            {context_summary.assistant_reply_count} replies
          </span>
          {context_summary.tool_call_count > 0 && (
            <span className="flex items-center gap-1">
              <Wrench className="w-3 h-3" />
              {context_summary.tool_call_count} tools
            </span>
          )}
          {context_summary.has_errors && (
            <span className="flex items-center gap-1 text-warning">
              <AlertCircle className="w-3 h-3" />
              Has errors
            </span>
          )}
        </div>

        <div className="flex items-start gap-3 text-[10px] text-muted">
          <div className="min-w-0 flex-1 space-y-2">
            {session && (
              <div className="flex min-w-0 max-w-full items-center gap-2 border border-border bg-paper px-2 py-1">
                <PanelsTopLeft className="h-3 w-3 flex-shrink-0" />
                <span className="min-w-0 flex-1 truncate" title={session.title || session.id}>
                  {session.title || `Session ${session.id.slice(0, 8)}`}
                </span>
                <span className="mono-text flex-shrink-0 text-[9px]">{session.turn_count} turns</span>
              </div>
            )}

            {context_summary.primary_model && (
              <div className="mono-text truncate text-[10px]">
                {context_summary.primary_model}
              </div>
            )}
          </div>

          <ChevronRight className="mt-1 h-3 w-3 flex-shrink-0" />
        </div>
      </div>
    </button>
  )
}

// =============================================================================
// Link State Badge
// =============================================================================

function LinkStateBadge({ 
  state, 
  confidence 
}: { 
  state: UserTurn['link_state']
  confidence?: number 
}) {
  switch (state) {
    case 'committed':
      return (
        <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] stamp-text bg-success/10 text-success">
          <GitCommit className="w-3 h-3" />
          COMMITTED
        </span>
      )
    case 'candidate':
      return (
        <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] stamp-text bg-candidate/10 text-candidate">
          <HelpCircle className="w-3 h-3" />
          CANDIDATE
          {confidence !== undefined && (
            <span className="mono-text font-normal">
              ({(confidence * 100).toFixed(0)}%)
            </span>
          )}
        </span>
      )
    case 'unlinked':
      return (
        <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] stamp-text bg-muted/10 text-muted">
          <Link2Off className="w-3 h-3" />
          UNLINKED
        </span>
      )
  }
}

// =============================================================================
// Non-virtualized list for smaller datasets
// =============================================================================

interface TurnListProps {
  turns: UserTurn[]
  selectedTurnId?: string
  onTurnSelect: (turn: UserTurn) => void
  getSession: (sessionId: string) => Session | undefined
  getProject: (projectId: string) => ProjectIdentity | undefined
  className?: string
}

export function TurnList({
  turns,
  selectedTurnId,
  onTurnSelect,
  getSession,
  getProject,
  className,
}: TurnListProps) {
  if (turns.length === 0) {
    return (
      <div className={cn('flex items-center justify-center h-full text-muted', className)}>
        <div className="text-center">
          <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No turns found</p>
        </div>
      </div>
    )
  }
  
  return (
    <div className={cn('h-full overflow-auto', className)}>
      {turns.map((turn) => {
        const session = getSession(turn.session_id)
        const project = turn.project_id ? getProject(turn.project_id) : undefined
        
        return (
          <TurnListItem
            key={turn.id}
            turn={turn}
            session={session}
            project={project}
            isSelected={turn.id === selectedTurnId}
            onClick={() => onTurnSelect(turn)}
          />
        )
      })}
    </div>
  )
}
