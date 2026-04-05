'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function AxisButton({
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

export function SummaryChip({
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

export function LegendChip({
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

export function MetricRow({
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
