import { cn } from '@/lib/utils'

export function SummaryPill({
  label,
  value,
  tone = 'normal',
  className,
}: {
  label: string
  value: string
  tone?: 'normal' | 'success' | 'warning' | 'candidate'
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 border px-2.5 py-1.5 text-xs',
        tone === 'success' && 'border-success/30 bg-success/10 text-success',
        tone === 'warning' && 'border-warning/30 bg-warning/10 text-warning',
        tone === 'candidate' && 'border-candidate/30 bg-candidate/10 text-candidate',
        tone === 'normal' && 'border-border bg-card text-muted',
        className,
      )}
    >
      <span className="text-[10px] stamp-text">{label}</span>
      <span className="font-medium text-ink">{value}</span>
    </span>
  )
}
