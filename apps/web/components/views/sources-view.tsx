'use client'

import { useMemo, useState } from 'react'
import { useSWRConfig } from 'swr'
import { cn, formatAbsoluteDateTime, formatRelativeTime } from '@/lib/utils'
import { useSourcesQuery } from '@/lib/api'
import type { SourceStatus, SourcePlatform } from '@/lib/types'
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FolderTree,
  RefreshCw,
  Search,
  Terminal,
  Code2,
  Bot,
  Zap,
  XCircle,
} from 'lucide-react'

export function SourcesView() {
  const { data: sources = [] } = useSourcesQuery()
  const { mutate } = useSWRConfig()
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'healthy' | 'stale' | 'error'>('all')
  const [sortBy, setSortBy] = useState<'last_sync' | 'name' | 'sessions' | 'turns' | 'status'>('last_sync')

  const filteredSources = useMemo(
    () =>
      sources.filter((source) => {
        const matchesQuery =
          query.trim().length === 0 ||
          source.display_name.toLowerCase().includes(query.toLowerCase()) ||
          source.platform.toLowerCase().includes(query.toLowerCase()) ||
          source.base_dir.toLowerCase().includes(query.toLowerCase())
        const matchesStatus = statusFilter === 'all' || source.sync_status === statusFilter
        return matchesQuery && matchesStatus
      }),
    [query, sources, statusFilter],
  )
  const sortedSources = useMemo(() => {
    const statusRank = { error: 0, stale: 1, healthy: 2 } as const
    const items = [...filteredSources]
    items.sort((left, right) => {
      if (sortBy === 'name') {
        return left.display_name.localeCompare(right.display_name)
      }
      if (sortBy === 'sessions') {
        return right.total_sessions - left.total_sessions
      }
      if (sortBy === 'turns') {
        return right.total_turns - left.total_turns
      }
      if (sortBy === 'status') {
        return statusRank[left.sync_status] - statusRank[right.sync_status]
      }
      return (right.last_sync?.getTime() ?? 0) - (left.last_sync?.getTime() ?? 0)
    })
    return items
  }, [filteredSources, sortBy])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex h-14 items-center justify-between border-b border-border bg-card px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Database className="h-5 w-5 text-ink" />
          <h1 className="text-lg font-bold font-display text-ink">Sources</h1>
          <span className="text-sm text-muted">{filteredSources.length} visible</span>
        </div>

        <button
          type="button"
          onClick={() => void mutate('/api/sources')}
          className="flex items-center gap-2 border border-border px-3 py-1.5 text-sm transition-colors hover:border-ink"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </header>

      <div className="flex flex-col gap-3 border-b border-border bg-paper px-4 py-3 sm:px-6 lg:flex-row lg:items-center">
        <div className="flex flex-1 items-center gap-2">
          <Search className="h-4 w-4 text-muted" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter sources by name, platform, or path..."
            className="flex-1 border border-border bg-card px-3 py-1.5 text-sm focus:border-ink focus:outline-none"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
          className="border border-border bg-card px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
        >
          <option value="all">All status</option>
          <option value="healthy">Healthy</option>
          <option value="stale">Stale</option>
          <option value="error">Error</option>
        </select>

        <select
          value={sortBy}
          onChange={(event) => setSortBy(event.target.value as typeof sortBy)}
          className="border border-border bg-card px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
        >
          <option value="last_sync">Recent Sync</option>
          <option value="turns">Most Turns</option>
          <option value="sessions">Most Sessions</option>
          <option value="status">Status</option>
          <option value="name">Name</option>
        </select>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="overflow-x-auto">
        <table className="min-w-[720px] w-full">
          <thead className="sticky top-0 border-b border-border bg-card">
            <tr>
              <th className="px-6 py-3 text-left text-[10px] stamp-text text-muted">SOURCE</th>
              <th className="px-6 py-3 text-left text-[10px] stamp-text text-muted">BASE DIR</th>
              <th className="px-6 py-3 text-left text-[10px] stamp-text text-muted">SESSIONS</th>
              <th className="px-6 py-3 text-left text-[10px] stamp-text text-muted">TURNS</th>
              <th className="px-6 py-3 text-left text-[10px] stamp-text text-muted">LAST SYNC</th>
              <th className="px-6 py-3 text-left text-[10px] stamp-text text-muted">STATUS</th>
            </tr>
          </thead>
          <tbody>
            {sortedSources.map((source) => (
              <tr key={source.id} className="border-b border-border transition-colors hover:bg-surface-hover">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center border border-border bg-paper">
                      <PlatformIcon platform={source.platform} />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-ink">{source.display_name}</div>
                      <div className="text-xs mono-text text-muted">{source.platform}</div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2 text-sm text-muted">
                    <FolderTree className="h-4 w-4" />
                    <span className="mono-text">{source.base_dir}</span>
                  </div>
                </td>
                <td className="px-6 py-4 mono-text text-sm">{source.total_sessions}</td>
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
                  <SyncStatusBadge status={source.sync_status} />
                  {source.error_message && (
                    <div className="mt-1 text-xs text-warning">{source.error_message}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        {sortedSources.length === 0 && (
          <div className="m-4 border border-dashed border-border px-6 py-12 text-center text-sm text-muted sm:m-6">
            No sources match the current filter.
          </div>
        )}
      </div>
    </div>
  )
}

function PlatformIcon({ platform }: { platform: SourcePlatform }) {
  if (platform === 'claude_code') return <Terminal className="h-4 w-4 text-muted" />
  if (platform === 'codex') return <Code2 className="h-4 w-4 text-muted" />
  if (platform === 'cursor' || platform === 'antigravity') return <Code2 className="h-4 w-4 text-muted" />
  if (platform === 'gemini' || platform === 'claude_web') return <Bot className="h-4 w-4 text-muted" />
  if (platform === 'amp' || platform === 'factory_droid' || platform === 'openclaw' || platform === 'opencode') {
    return <Zap className="h-4 w-4 text-muted" />
  }
  return <Database className="h-4 w-4 text-muted" />
}

function SyncStatusBadge({ status }: { status: SourceStatus['sync_status'] }) {
  const config = {
    healthy: {
      label: 'HEALTHY',
      className: 'border-success text-success bg-success/5',
      icon: <CheckCircle2 className="h-3 w-3" />,
    },
    stale: {
      label: 'STALE',
      className: 'border-candidate text-candidate bg-candidate/5',
      icon: <AlertTriangle className="h-3 w-3" />,
    },
    error: {
      label: 'ERROR',
      className: 'border-warning text-warning bg-warning/5',
      icon: <XCircle className="h-3 w-3" />,
    },
  } as const

  const entry = config[status]
  return (
    <span className={cn('inline-flex items-center gap-1 border px-2 py-1 text-[10px] stamp-text', entry.className)}>
      {entry.icon}
      {entry.label}
    </span>
  )
}
