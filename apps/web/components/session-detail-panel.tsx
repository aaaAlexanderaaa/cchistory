'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { ProjectIdentity, Session, UserTurn } from '@/lib/types'
import { ChevronLeft, Clock, FolderOpen, Layers, MonitorSmartphone, X } from 'lucide-react'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'

interface SessionDetailPanelProps {
  session: Session
  turns: UserTurn[]
  selectedTurnId?: string
  project?: ProjectIdentity
  onBack: () => void
  onClose: () => void
  onSelectTurn: (turnId: string) => void
  className?: string
}

export function SessionDetailPanel({
  session,
  turns,
  selectedTurnId,
  project,
  onBack,
  onClose,
  onSelectTurn,
  className,
}: SessionDetailPanelProps) {
  return (
    <div className={cn('flex h-full min-h-0 flex-col border-l border-border bg-card', className)}>
      <div className="flex-shrink-0 border-b border-border">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to turn detail"
              className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted transition-colors hover:bg-surface-hover hover:text-ink"
            >
              <ChevronLeft className="h-4 w-4" />
              Turn
            </button>
            <span className="text-[10px] stamp-text text-muted">SESSION DETAIL</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close session detail"
            className="p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 pb-4">
          <h2
            className="line-clamp-3 text-lg font-bold font-display text-ink"
            title={session.title || 'Untitled Session'}
          >
            {session.title || 'Untitled Session'}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
            <MetaBadge icon={<Layers className="h-3 w-3" />} label={`${turns.length} turns`} />
            <MetaBadge icon={<MonitorSmartphone className="h-3 w-3" />} label={session.source_platform} />
            {project && <MetaBadge icon={<FolderOpen className="h-3 w-3" />} label={project.name} tone="accent" />}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <section className="px-4 py-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[10px] stamp-text text-muted">TURN SEQUENCE</div>
            <div className="flex items-center gap-1 text-[10px] text-muted">
              <Clock className="h-3 w-3" />
              Oldest first
            </div>
          </div>

          <div className="space-y-2">
            {turns.map((turn, index) => (
              <button
                type="button"
                key={turn.id}
                onClick={() => onSelectTurn(turn.id)}
                className={cn(
                  'w-full border px-3 py-3 text-left transition-colors',
                  selectedTurnId === turn.id
                    ? 'border-accent bg-accent/5'
                    : 'border-border bg-paper hover:border-ink hover:bg-surface-hover',
                )}
              >
                <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                  <span className="mono-text text-muted">TURN {index + 1}</span>
                  <span className="text-muted">{format(turn.created_at, 'MM-dd HH:mm', { locale: zhCN })}</span>
                </div>
                <div className="text-sm text-ink line-clamp-3">{turn.canonical_text}</div>
                <div className="mt-2 flex items-center gap-2 text-[10px] stamp-text">
                  <LinkStateChip state={turn.link_state} confidence={turn.project_confidence} />
                  <span className="text-muted">{turn.context_summary.assistant_reply_count} replies</span>
                  <span className="text-muted">{turn.context_summary.tool_call_count} tools</span>
                </div>
              </button>
            ))}

            {turns.length === 0 && (
              <div className="border border-dashed border-border px-4 py-10 text-center text-sm text-muted">
                No turns loaded for this session.
              </div>
            )}
          </div>
        </section>

        <section className="border-t border-border px-4 py-4">
          <div className="mb-3 text-[10px] stamp-text text-muted">SESSION METADATA</div>
          <div className="grid grid-cols-1 gap-3 text-sm">
            <MetaRow label="Created" value={format(session.created_at, 'yyyy-MM-dd HH:mm', { locale: zhCN })} />
            <MetaRow label="Updated" value={format(session.updated_at, 'yyyy-MM-dd HH:mm', { locale: zhCN })} />
            <MetaRow label="Model" value={session.model || 'Unknown'} />
            <MetaRow label="Host" value={session.host_id} mono />
            {session.working_directory && <MetaRow label="Working Dir" value={session.working_directory} mono />}
          </div>
        </section>
      </div>
    </div>
  )
}

function MetaBadge({
  icon,
  label,
  tone = 'muted',
}: {
  icon: ReactNode
  label: string
  tone?: 'muted' | 'accent'
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 border px-2 py-1',
        tone === 'accent' ? 'border-accent/30 bg-accent/5 text-accent' : 'border-border bg-paper text-muted',
      )}
    >
      {icon}
      {label}
    </span>
  )
}

function MetaRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/50 pb-2 last:border-b-0 last:pb-0">
      <span className="text-xs text-muted">{label}</span>
      <span className={cn('text-right text-ink', mono && 'mono-text text-xs')}>{value}</span>
    </div>
  )
}

function LinkStateChip({ state, confidence }: { state: UserTurn['link_state']; confidence?: number }) {
  if (state === 'committed') {
    return <span className="border border-success/30 bg-success/10 px-1.5 py-0.5 text-success">COMMITTED</span>
  }
  if (state === 'candidate') {
    return (
      <span className="border border-candidate/30 bg-candidate/10 px-1.5 py-0.5 text-candidate">
        {confidence ? `${Math.round(confidence * 100)}%` : 'CANDIDATE'}
      </span>
    )
  }
  return <span className="border border-border bg-card px-1.5 py-0.5 text-muted">UNLINKED</span>
}
