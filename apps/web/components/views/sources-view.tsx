'use client'

import { useMemo, useState } from 'react'
import { useSWRConfig } from 'swr'
import { cn, formatAbsoluteDateTime, formatRelativeTime } from '@/lib/utils'
import { createSourceConfig, resetSourceConfig, updateSourceConfig, useSourcesQuery } from '@/lib/api'
import type { SourceStatus, SourcePlatform } from '@/lib/types'
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FolderTree,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Terminal,
  Code2,
  Bot,
  Zap,
  XCircle,
} from 'lucide-react'

const MANUAL_SOURCE_OPTIONS: Array<{ platform: SourcePlatform; label: string }> = [
  { platform: 'codex', label: 'Codex' },
  { platform: 'claude_code', label: 'Claude Code' },
  { platform: 'factory_droid', label: 'Factory Droid' },
  { platform: 'amp', label: 'AMP' },
  { platform: 'cursor', label: 'Cursor' },
  { platform: 'antigravity', label: 'Antigravity' },
  { platform: 'openclaw', label: 'OpenClaw' },
  { platform: 'opencode', label: 'OpenCode' },
  { platform: 'lobechat', label: 'LobeChat' },
]

export function SourcesView() {
  const { data: sources = [] } = useSourcesQuery()
  const { mutate } = useSWRConfig()
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'healthy' | 'stale' | 'error'>('all')
  const [sortBy, setSortBy] = useState<'last_sync' | 'name' | 'sessions' | 'turns' | 'status'>('last_sync')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Record<string, { kind: 'success' | 'error'; text: string }>>({})
  const [newSourcePlatform, setNewSourcePlatform] = useState<SourcePlatform>('codex')
  const [newSourcePath, setNewSourcePath] = useState('')
  const [createMessage, setCreateMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

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

  async function refreshSourceDerivedQueries() {
    await mutate((key) => isSourceDerivedQueryKey(key), undefined, { revalidate: true })
  }

  async function handleSave(source: SourceStatus) {
    const nextBaseDir = (drafts[source.id] ?? source.base_dir).trim()
    if (!nextBaseDir) {
      setMessages((current) => ({
        ...current,
        [source.id]: { kind: 'error', text: 'Directory cannot be empty.' },
      }))
      return
    }

    setActiveSourceId(source.id)
    setMessages((current) => {
      const next = { ...current }
      delete next[source.id]
      return next
    })

    try {
      await updateSourceConfig(source.id, nextBaseDir)
      await refreshSourceDerivedQueries()
      setMessages((current) => ({
        ...current,
        [source.id]: { kind: 'success', text: 'Saved and re-scanned.' },
      }))
    } catch (error) {
      setMessages((current) => ({
        ...current,
        [source.id]: { kind: 'error', text: formatActionError(error, 'Failed to save source directory.') },
      }))
    } finally {
      setActiveSourceId(null)
    }
  }

  async function handleReset(source: SourceStatus) {
    setActiveSourceId(source.id)
    setMessages((current) => {
      const next = { ...current }
      delete next[source.id]
      return next
    })

    try {
      await resetSourceConfig(source.id)
      await refreshSourceDerivedQueries()
      setDrafts((current) => {
        const next = { ...current }
        delete next[source.id]
        return next
      })
      setMessages((current) => ({
        ...current,
        [source.id]: { kind: 'success', text: 'Reset to automatic discovery and re-scanned.' },
      }))
    } catch (error) {
      setMessages((current) => ({
        ...current,
        [source.id]: { kind: 'error', text: formatActionError(error, 'Failed to reset source directory.') },
      }))
    } finally {
      setActiveSourceId(null)
    }
  }

  async function handleCreateSource() {
    const nextBaseDir = newSourcePath.trim()
    if (!nextBaseDir) {
      setCreateMessage({ kind: 'error', text: 'Directory cannot be empty.' })
      return
    }

    setActiveSourceId('__create__')
    setCreateMessage(null)

    try {
      await createSourceConfig({
        platform: newSourcePlatform,
        base_dir: nextBaseDir,
      })
      await refreshSourceDerivedQueries()
      setNewSourcePath('')
      setCreateMessage({ kind: 'success', text: 'Manual source added and scanned.' })
    } catch (error) {
      setCreateMessage({
        kind: 'error',
        text: formatActionError(error, 'Failed to add manual source.'),
      })
    } finally {
      setActiveSourceId(null)
    }
  }

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

      <div className="border-b border-border bg-card px-4 py-3 sm:px-6">
        <div className="text-sm text-muted">
          Automatic discovery only includes source types whose default host path exists. Add manual instances when the
          same source type lives in another directory.
        </div>
        <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-center">
          <select
            value={newSourcePlatform}
            onChange={(event) => setNewSourcePlatform(event.target.value as SourcePlatform)}
            className="border border-border bg-paper px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none"
          >
            {MANUAL_SOURCE_OPTIONS.map((option) => (
              <option key={option.platform} value={option.platform}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={newSourcePath}
            onChange={(event) => setNewSourcePath(event.target.value)}
            placeholder="Add another source path..."
            className="min-w-[320px] flex-1 border border-border bg-paper px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void handleCreateSource()}
            disabled={activeSourceId === '__create__'}
            className="flex items-center justify-center gap-2 border border-border px-3 py-2 text-sm transition-colors hover:border-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {activeSourceId === '__create__' ? 'Adding...' : 'Add Manual Source'}
          </button>
        </div>
        {createMessage && (
          <div className={cn('mt-2 text-xs', createMessage.kind === 'success' ? 'text-success' : 'text-warning')}>
            {createMessage.text}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="overflow-x-auto">
        <table className="min-w-[1120px] w-full">
          <thead className="sticky top-0 border-b border-border bg-card">
            <tr>
              <th className="px-6 py-3 text-left text-[10px] stamp-text text-muted">SOURCE</th>
              <th className="px-6 py-3 text-left text-[10px] stamp-text text-muted">DIRECTORY</th>
              <th className="px-6 py-3 text-left text-[10px] stamp-text text-muted">SESSIONS</th>
              <th className="px-6 py-3 text-left text-[10px] stamp-text text-muted">TURNS</th>
              <th className="px-6 py-3 text-left text-[10px] stamp-text text-muted">LAST SYNC</th>
              <th className="px-6 py-3 text-left text-[10px] stamp-text text-muted">STATUS</th>
              <th className="px-6 py-3 text-left text-[10px] stamp-text text-muted">ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {sortedSources.map((source) => {
              const draftValue = drafts[source.id] ?? source.base_dir
              const isDirty = draftValue.trim() !== source.base_dir
              const isBusy = activeSourceId === source.id
              const message = messages[source.id]

              return (
              <tr key={source.id} className="border-b border-border align-top transition-colors hover:bg-surface-hover">
                <td className="px-6 py-4 align-top">
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
                <td className="px-6 py-4 align-top">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm text-muted">
                      <FolderTree className="h-4 w-4 shrink-0" />
                      <input
                        type="text"
                        value={draftValue}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [source.id]: event.target.value,
                          }))
                        }
                        className="w-full min-w-[360px] border border-border bg-card px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-[10px] stamp-text">
                      <span
                        className={cn(
                          'inline-flex items-center border px-2 py-1',
                          source.is_overridden
                            ? 'border-ink text-ink bg-paper'
                            : source.is_default_source
                              ? 'border-border text-muted bg-card'
                              : 'border-candidate text-candidate bg-candidate/5',
                        )}
                      >
                        {source.is_overridden ? 'OVERRIDE' : source.is_default_source ? 'AUTO' : 'MANUAL'}
                      </span>
                      <span
                        className={cn(
                          'inline-flex items-center border px-2 py-1',
                          source.path_exists
                            ? 'border-success text-success bg-success/5'
                            : 'border-warning text-warning bg-warning/5',
                        )}
                      >
                        {source.path_exists ? 'FOUND' : 'MISSING'}
                      </span>
                    </div>

                    <div className="space-y-1 text-xs text-muted">
                      {source.default_base_dir ? (
                        <div className="mono-text break-all">Default: {source.default_base_dir}</div>
                      ) : (
                        <div className="mono-text break-all">Manual source instance</div>
                      )}
                      {source.override_base_dir && (
                        <div className="mono-text break-all">Override: {source.override_base_dir}</div>
                      )}
                    </div>

                    {!source.path_exists && (
                      <div className="text-xs text-warning">
                        Configured directory is missing. This source cannot be discovered until it points at a real path.
                      </div>
                    )}

                    {message && (
                      <div
                        className={cn(
                          'text-xs',
                          message.kind === 'success' ? 'text-success' : 'text-warning',
                        )}
                      >
                        {message.text}
                      </div>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 align-top mono-text text-sm">{source.total_sessions}</td>
                <td className="px-6 py-4 align-top mono-text text-sm">{source.total_turns.toLocaleString()}</td>
                <td className="px-6 py-4 align-top text-sm text-muted">
                  {source.last_sync ? (
                    <div className="space-y-0.5">
                      <div className="mono-text text-xs text-ink">{formatAbsoluteDateTime(source.last_sync)}</div>
                      <div className="text-xs text-muted">{formatRelativeTime(source.last_sync)}</div>
                    </div>
                  ) : (
                    'Never'
                  )}
                </td>
                <td className="px-6 py-4 align-top">
                  <SyncStatusBadge status={source.sync_status} />
                  {source.error_message && (
                    <div className="mt-1 text-xs text-warning">{source.error_message}</div>
                  )}
                </td>
                <td className="px-6 py-4 align-top">
                  <div className="flex min-w-[220px] flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => void handleSave(source)}
                      disabled={isBusy || !isDirty}
                      className="flex items-center justify-center gap-2 border border-border px-3 py-2 text-sm transition-colors hover:border-ink disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Save className="h-4 w-4" />
                      {isBusy ? 'Saving...' : 'Save & Rescan'}
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleReset(source)}
                      disabled={isBusy || !source.is_overridden || !source.is_default_source}
                      className="flex items-center justify-center gap-2 border border-border px-3 py-2 text-sm transition-colors hover:border-ink disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RotateCcw className={cn('h-4 w-4', isBusy && 'animate-spin')} />
                      Reset to Default
                    </button>
                  </div>
                </td>
              </tr>
              )
            })}
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

function formatActionError(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function isSourceDerivedQueryKey(key: unknown) {
  return (
    typeof key === 'string' &&
    (
      key === '/api/sources' ||
      key.startsWith('/api/turns') ||
      key.startsWith('/api/sessions') ||
      key.startsWith('/api/projects') ||
      key === '/api/admin/linking' ||
      key === '/api/admin/linking/overrides' ||
      key === '/api/admin/drift' ||
      key.startsWith('["turn-search"')
    )
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
