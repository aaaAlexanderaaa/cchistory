'use client'

import { cn, formatAbsoluteDateTime, formatRelativeTime } from '@/lib/utils'
import type { Session, UserTurn } from '@/lib/types'
import { MessageSquare, Code, Wrench, AlertTriangle, CheckCircle2, Clock, GripVertical } from 'lucide-react'
import { SessionBadge } from './session-badge'

interface TurnCardProps {
  turn: UserTurn
  session?: Session
  projectColor?: string
  variant?: 'default' | 'compact' | 'inbox'
  selected?: boolean
  draggable?: boolean
  onClick?: () => void
}

export function TurnCard({ 
  turn, 
  session,
  projectColor,
  variant = 'default',
  selected = false,
  draggable = false,
  onClick,
}: TurnCardProps) {
  const borderColor = projectColor || '#E0E0E0'
  const interactive = Boolean(onClick) && !draggable
  const turnIdLabel = variant === 'inbox'
    ? turn.id.slice(0, 8).toUpperCase()
    : turn.id.toUpperCase().replace('TURN-', '#')
  const className = cn(
    "h-full w-full border border-border bg-card text-left transition-all",
    "flex flex-col",
    interactive ? "cursor-pointer" : "cursor-default",
    "hover:shadow-hover",
    selected ? "shadow-hover border-accent" : "shadow-hard",
    draggable && "cursor-grab active:cursor-grabbing",
    variant === 'compact' && "p-3",
    variant === 'default' && "p-4",
    variant === 'inbox' && "p-3.5",
  )
  const style = { 
    borderLeftWidth: '4px', 
    borderLeftColor: borderColor,
  } as const
  const content = (
    <>
      {/* Header */}
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {draggable && (
            <GripVertical className="w-4 h-4 text-muted" />
          )}
          <span className="mono-text text-muted">
            {turnIdLabel}
          </span>
          <span className="mono-text text-muted">
            {formatAbsoluteDateTime(turn.created_at)}
          </span>
          <span className="text-[10px] text-muted">
            {formatRelativeTime(turn.created_at)}
          </span>
        </div>
        
        {/* Status badges */}
        <div className="flex flex-wrap items-center gap-1">
          {turn.link_state === 'unlinked' && (
            <StatusBadge status="unlinked" />
          )}
          {turn.link_state === 'candidate' && (
            <StatusBadge status="candidate" confidence={turn.project_confidence} />
          )}
          {turn.link_state === 'committed' && (
            <StatusBadge status="verified" />
          )}
          {turn.is_flagged && (
            <StatusBadge status="flagged" />
          )}
          {turn.sync_axis === 'superseded' && (
            <StatusBadge status="superseded" />
          )}
        </div>
      </div>
      
      {/* User's question - the core content */}
      <p className={cn(
        "text-text leading-relaxed flex-1",
        variant === 'compact' ? "text-sm line-clamp-2" : "text-sm line-clamp-3"
      )}>
        {turn.canonical_text}
      </p>

      {session && (
        <div className="mt-3">
          <SessionBadge
            session={session}
            compact
            showTitle={variant !== 'inbox'}
            showPlatform={variant === 'inbox' ? true : undefined}
          />
        </div>
      )}
      
      {/* Footer - AI Response indicators */}
      {variant !== 'inbox' && (
        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
            <div className="flex items-center gap-1">
              <MessageSquare className="w-3.5 h-3.5" />
              <span className="mono-text">Reply</span>
            </div>
            {turn.tags && turn.tags.length > 0 && (
              <div className="flex items-center gap-1">
                {turn.tags.slice(0, 2).map((tag) => (
                  <span key={tag} className="text-[10px] text-muted px-1.5 py-0.5 bg-paper">
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
  
  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={className}
        style={style}
      >
        {content}
      </button>
    )
  }

  return (
    <div
      onClick={onClick}
      className={className}
      style={style}
    >
      {content}
    </div>
  )
}

interface StatusBadgeProps {
  status: 'unlinked' | 'candidate' | 'verified' | 'review' | 'flagged' | 'superseded'
  confidence?: number
}

function StatusBadge({ status, confidence }: StatusBadgeProps) {
  const configs = {
    unlinked: {
      label: 'UNLINKED',
      className: 'border-border text-muted',
      icon: null,
    },
    candidate: {
      label: confidence ? `${Math.round(confidence * 100)}%` : 'CANDIDATE',
      className: 'border-candidate text-candidate',
      icon: null,
    },
    verified: {
      label: 'VERIFIED',
      className: 'border-success text-success',
      icon: <CheckCircle2 className="w-3 h-3" />,
    },
    review: {
      label: 'REVIEW',
      className: 'border-warning text-warning',
      icon: <Clock className="w-3 h-3" />,
    },
    flagged: {
      label: 'FLAGGED',
      className: 'border-warning bg-warning/10 text-warning',
      icon: <AlertTriangle className="w-3 h-3" />,
    },
    superseded: {
      label: 'STALE',
      className: 'border-muted text-muted bg-surface-hover',
      icon: null,
    },
  }
  
  const config = configs[status]
  
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] stamp-text border",
      config.className
    )}>
      {config.icon}
      {config.label}
    </span>
  )
}
