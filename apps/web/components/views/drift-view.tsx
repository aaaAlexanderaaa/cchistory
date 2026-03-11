'use client'

import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { useSWRConfig } from 'swr'
import { cn, formatAbsoluteDateTime, formatRelativeTime } from '@/lib/utils'
import { useDriftQuery, useSourcesQuery } from '@/lib/api'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  XCircle,
} from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export function DriftView() {
  const { data: drift } = useDriftQuery()
  const { data: sources = [] } = useSourcesQuery()
  const { mutate } = useSWRConfig()
  const [sourceSort, setSourceSort] = useState<'status' | 'last_sync' | 'turns' | 'name'>('status')

  const chartData = useMemo(
    () =>
      (drift?.timeline ?? []).map((point) => ({
        date: point.date.toISOString().slice(5, 10),
        drift: Math.round(point.global_drift_index * 1000) / 10,
        consistency: Math.round(point.consistency_score * 1000) / 10,
        totalTurns: point.total_turns,
      })),
    [drift],
  )
  const sortedSources = useMemo(() => {
    const statusRank = { error: 0, stale: 1, healthy: 2 } as const
    const items = [...sources]
    items.sort((left, right) => {
      if (sourceSort === 'name') {
        return left.display_name.localeCompare(right.display_name)
      }
      if (sourceSort === 'turns') {
        return right.total_turns - left.total_turns
      }
      if (sourceSort === 'last_sync') {
        return (right.last_sync?.getTime() ?? 0) - (left.last_sync?.getTime() ?? 0)
      }
      return statusRank[left.sync_status] - statusRank[right.sync_status]
    })
    return items
  }, [sourceSort, sources])

  if (!drift) {
    return <div className="flex flex-1 items-center justify-center text-sm text-muted">Loading drift diagnostics…</div>
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="border-b border-border bg-card">
        <div className="flex flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-3">
              <Activity className="h-5 w-5 text-ink" />
              <h1 className="text-lg font-bold font-display text-ink">Drift Monitor</h1>
              {drift.consistency_score < 0.95 && (
                <span className="inline-flex items-center gap-1 border border-warning/30 bg-warning/10 px-2 py-1 text-[10px] stamp-text text-warning">
                  <AlertTriangle className="h-3 w-3" />
                  Consistency below 95%
                </span>
              )}
            </div>
            <div className="text-xs text-muted">
              Admin diagnostics for parser drift, consistency, and source sync lag.
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              void mutate('/api/admin/drift')
              void mutate('/api/sources')
            }}
            className="flex items-center gap-2 border border-border px-3 py-1.5 text-sm transition-colors hover:border-ink"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-paper px-4 py-2 sm:px-6">
          <SummaryPill label="Global Drift" value={`${Math.round(drift.global_drift_index * 100)}%`} />
          <SummaryPill
            label="Consistency"
            value={`${Math.round(drift.consistency_score * 100)}%`}
            tone={drift.consistency_score >= 0.95 ? 'success' : 'warning'}
          />
          <SummaryPill
            label="Unlinked Turns"
            value={String(drift.unlinked_turns)}
            tone={drift.unlinked_turns === 0 ? 'success' : 'warning'}
          />
          <SummaryPill
            label="Sources Awaiting Sync"
            value={String(drift.sources_awaiting_sync)}
            tone={drift.sources_awaiting_sync === 0 ? 'success' : 'warning'}
          />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mb-6 border border-border bg-card p-6 shadow-hard">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h2 className="text-lg font-bold font-display text-ink">Drift Timeline</h2>
              <p className="text-sm text-muted">Current drift and consistency snapshots over the last seven days.</p>
            </div>
          </div>

          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E0E0E0" />
                <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#757575' }} />
                <YAxis tick={{ fontSize: 12, fill: '#757575' }} tickFormatter={(value) => `${value}%`} />
                <Tooltip formatter={(value: number, name: string) => [`${value}%`, name === 'drift' ? 'Drift' : 'Consistency']} />
                <Line type="monotone" dataKey="drift" stroke="#FF4800" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="consistency" stroke="#22C55E" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="border border-border bg-card shadow-hard">
          <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
            <h2 className="text-lg font-bold font-display text-ink">Source Health Matrix</h2>
            <select
              value={sourceSort}
              onChange={(event) => setSourceSort(event.target.value as typeof sourceSort)}
              className="border border-border bg-card px-2 py-1.5 text-sm text-text focus:border-ink focus:outline-none"
            >
              <option value="status">Status</option>
              <option value="last_sync">Recent Sync</option>
              <option value="turns">Most Turns</option>
              <option value="name">Name</option>
            </select>
          </div>
          <div className="overflow-x-auto">
          <table className="min-w-[620px] w-full">
            <thead className="border-b border-border">
              <tr>
                <th className="px-6 py-3 text-left text-[10px] stamp-text text-muted">SOURCE</th>
                <th className="px-6 py-3 text-left text-[10px] stamp-text text-muted">TURNS</th>
                <th className="px-6 py-3 text-left text-[10px] stamp-text text-muted">LAST SYNC</th>
                <th className="px-6 py-3 text-left text-[10px] stamp-text text-muted">STATUS</th>
              </tr>
            </thead>
            <tbody>
              {sortedSources.map((source) => (
                <tr key={source.id} className="border-b border-border transition-colors hover:bg-surface-hover">
                  <td className="px-6 py-4">
                    <div className="font-medium text-ink">{source.display_name}</div>
                    <div className="text-xs mono-text text-muted">{source.base_dir}</div>
                  </td>
                  <td className="px-6 py-4 mono-text text-sm">{source.total_turns.toLocaleString()}</td>
                  <td className="px-6 py-4 text-sm text-muted">
                    {source.last_sync ? (
                      <div className="space-y-0.5">
                        <div className="mono-text text-xs text-ink">{formatAbsoluteDateTime(source.last_sync)}</div>
                        <div className="text-xs text-muted">{formatRelativeTime(source.last_sync)}</div>
                      </div>
                    ) : (
                      'Never'
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <StatusPill status={source.sync_status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      </div>
    </div>
  )
}

function SummaryPill({
  label,
  value,
  tone = 'normal',
}: {
  label: string
  value: string
  tone?: 'normal' | 'success' | 'warning'
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 border px-2.5 py-1.5 text-xs',
        tone === 'success' && 'border-success/30 bg-success/10 text-success',
        tone === 'warning' && 'border-warning/30 bg-warning/10 text-warning',
        tone === 'normal' && 'border-border bg-card text-muted',
      )}
    >
      <span className="text-[10px] stamp-text">{label}</span>
      <span className="font-medium text-ink">{value}</span>
    </span>
  )
}

function StatusPill({ status }: { status: 'healthy' | 'stale' | 'error' }) {
  const config: Record<typeof status, { icon: ReactNode; className: string; label: string }> = {
    healthy: {
      icon: <CheckCircle2 className="h-3 w-3" />,
      className: 'border-success text-success bg-success/5',
      label: 'HEALTHY',
    },
    stale: {
      icon: <AlertTriangle className="h-3 w-3" />,
      className: 'border-candidate text-candidate bg-candidate/5',
      label: 'STALE',
    },
    error: {
      icon: <XCircle className="h-3 w-3" />,
      className: 'border-warning text-warning bg-warning/5',
      label: 'ERROR',
    },
  }

  return (
    <span className={cn('inline-flex items-center gap-1 border px-2 py-1 text-[10px] stamp-text', config[status].className)}>
      {config[status].icon}
      {config[status].label}
    </span>
  )
}
