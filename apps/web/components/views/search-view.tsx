'use client'

import { useMemo, useState } from 'react'
import { cn, formatAbsoluteDateTime, formatRelativeTime } from '@/lib/utils'
import { TurnDetailPanel } from '@/components/turn-detail-panel'
import { SessionBadge } from '@/components/session-badge'
import { ResponsiveSidePanel } from '@/components/responsive-side-panel'
import type { ProjectIdentity, SearchResult } from '@/lib/types'
import {
  createProjectStub,
  useProjectsQuery,
  useSessionQuery,
  useTurnContextQuery,
  useTurnQuery,
  useTurnSearchQuery,
} from '@/lib/api'
import {
  Search,
  X,
  FolderOpen,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'

type SearchSort = 'relevance' | 'newest' | 'oldest'

export function SearchView({
  initialQuery = '',
  onClose,
}: {
  initialQuery?: string
  onClose?: () => void
}) {
  const [query, setQuery] = useState(initialQuery)
  const [showArchived, setShowArchived] = useState(false)
  const [showCovered, setShowCovered] = useState(false)
  const [showCandidates, setShowCandidates] = useState(false)
  const [sortBy, setSortBy] = useState<SearchSort>('relevance')
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null)
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(new Set())
  const { data: projects = [] } = useProjectsQuery('all')
  const hasQuery = query.trim().length > 0
  const { data: results = [] } = useTurnSearchQuery(
    hasQuery
      ? {
          query,
          link_states: showCandidates ? ['committed', 'candidate', 'unlinked'] : ['committed'],
          value_axes: [
            'active',
            ...(showCovered ? (['covered'] as const) : []),
            ...(showArchived ? (['archived'] as const) : []),
          ],
          limit: 100,
        }
      : {},
  )

  const projectRegistry = useMemo(() => {
    const registry = new Map<string, ProjectIdentity>()
    for (const project of projects) {
      registry.set(project.id, project)
    }
    for (const result of results) {
      if (result.project) {
        registry.set(result.project.id, result.project)
      }
      if (result.turn.project_id && !registry.has(result.turn.project_id)) {
        registry.set(result.turn.project_id, createProjectStub(result.turn.project_id))
      }
    }
    return registry
  }, [projects, results])

  const groupedResults = useMemo(() => {
    const sortedResults = [...results].sort((left, right) => {
      if (sortBy === 'newest') {
        return right.turn.created_at.getTime() - left.turn.created_at.getTime()
      }
      if (sortBy === 'oldest') {
        return left.turn.created_at.getTime() - right.turn.created_at.getTime()
      }
      return right.relevance_score - left.relevance_score
    })

    const grouped = new Map<string, { project?: ProjectIdentity; results: SearchResult[] }>()
    for (const result of sortedResults) {
      const projectId = result.project?.id ?? result.turn.project_id ?? 'unlinked'
      const current = grouped.get(projectId)
      if (current) {
        current.results.push(result)
        continue
      }
      grouped.set(projectId, { project: result.project, results: [result] })
    }
    return [...grouped.entries()]
  }, [results, sortBy])
  const effectiveSelectedTurnId = useMemo(() => {
    if (!hasQuery) {
      return null
    }

    if (selectedTurnId && results.some((result) => result.turn.id === selectedTurnId)) {
      return selectedTurnId
    }

    return results[0]?.turn.id ?? null
  }, [hasQuery, results, selectedTurnId])

  const selectedResult = useMemo(
    () => results.find((result) => result.turn.id === effectiveSelectedTurnId) ?? null,
    [effectiveSelectedTurnId, results],
  )
  const { data: selectedTurnDetail } = useTurnQuery(selectedResult?.turn.id)
  const selectedTurn = selectedTurnDetail ?? selectedResult?.turn ?? null
  const { data: selectedContext } = useTurnContextQuery(selectedTurn?.id)
  const { data: selectedSession } = useSessionQuery(selectedTurn?.session_id)
  const selectedProject = selectedTurn?.project_id
    ? projectRegistry.get(selectedTurn.project_id) ?? createProjectStub(selectedTurn.project_id)
    : selectedResult?.project

  const toggleProject = (projectId: string) => {
    setCollapsedProjectIds((previous) => {
      const next = new Set(previous)
      if (next.has(projectId)) {
        next.delete(projectId)
      } else {
        next.add(projectId)
      }
      return next
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper lg:flex-row">
      <div className={cn('flex min-w-0 flex-1 flex-col', selectedTurn && 'lg:border-r lg:border-border')}>
        <header className="border-b border-border bg-card">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            <Search className="h-5 w-5 text-warning" />
            <div className="min-w-0 flex-1">
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search canonical turn text..."
                className="w-full bg-transparent text-base outline-none placeholder:text-muted"
                autoFocus
              />
            </div>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3 text-xs sm:px-6">
            <span className="text-muted">Canonical UserTurn results; project and session stay contextual.</span>
            <FilterChip label="Archived" active={showArchived} onClick={() => setShowArchived((value) => !value)} />
            <FilterChip label="Covered" active={showCovered} onClick={() => setShowCovered((value) => !value)} />
            <FilterChip label="Candidates" active={showCandidates} onClick={() => setShowCandidates((value) => !value)} />
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as SearchSort)}
              className="border border-border bg-card px-2 py-1 text-xs text-text focus:border-ink focus:outline-none"
            >
              <option value="relevance">Best Match</option>
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
            </select>
            <span className="w-full text-muted sm:ml-auto sm:w-auto">
              {hasQuery ? `${results.length} matches` : 'Type to search'}
            </span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {!hasQuery && (
            <EmptyState title="Start typing" detail="Search runs against masked canonical turn text." />
          )}

          {hasQuery && results.length === 0 && (
            <EmptyState title="No matches" detail="Try broader terms or include archived/candidate turns." />
          )}

          <div className="space-y-5">
            {groupedResults.map(([projectId, group]) => (
              <section key={projectId} className="border border-border bg-card">
                <button
                  type="button"
                  onClick={() => toggleProject(projectId)}
                  className="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors hover:bg-surface-hover"
                >
                  {!collapsedProjectIds.has(projectId) ? (
                    <ChevronDown className="h-4 w-4 text-muted" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted" />
                  )}
                  <FolderOpen className="h-4 w-4 text-warning" />
                  <span className="font-medium text-ink">
                    {group.project?.name ?? projectRegistry.get(projectId)?.name ?? 'Unlinked'}
                  </span>
                  <span className="ml-auto text-xs text-muted">{group.results.length} matches</span>
                </button>

                {!collapsedProjectIds.has(projectId) && (
                  <div className="divide-y divide-border">
                    {group.results.map((result) => (
                      <button
                        type="button"
                        key={result.turn.id}
                        onClick={() => setSelectedTurnId(result.turn.id)}
                        className={cn(
                          'w-full border-l-4 px-4 py-3.5 text-left transition-colors hover:bg-surface-hover',
                          selectedTurn?.id === result.turn.id ? 'border-l-accent bg-accent/5' : 'border-l-transparent',
                        )}
                      >
                        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
                          <span>{formatRelativeTime(result.turn.created_at)}</span>
                          <span className="mono-text">{formatAbsoluteDateTime(result.turn.created_at)}</span>
                          {result.turn.link_state !== 'committed' && (
                            <span className="border border-border bg-paper px-1.5 py-0.5 stamp-text text-muted">
                              {result.turn.link_state}
                            </span>
                          )}
                        </div>
                        <div className="line-clamp-3 text-[15px] leading-6 text-text">{renderHighlightedText(result)}</div>
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] stamp-text">
                          <SessionBadge session={result.session} compact />
                          <span className="border border-border bg-paper px-1.5 py-0.5 text-muted">
                            {result.turn.context_summary.assistant_reply_count} replies
                          </span>
                          <span className="border border-border bg-paper px-1.5 py-0.5 text-muted">
                            {summarizeTurnId(result.turn.id)}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        </div>
      </div>

      {selectedTurn && (
        <ResponsiveSidePanel onDismiss={() => setSelectedTurnId(null)} className="lg:w-[34rem] lg:flex-shrink-0 xl:w-[38rem]">
          <TurnDetailPanel
            turn={selectedTurn}
            context={selectedContext}
            session={selectedSession}
            project={selectedProject}
            onClose={() => setSelectedTurnId(null)}
            className="h-full lg:w-[34rem] lg:flex-shrink-0 xl:w-[38rem]"
          />
        </ResponsiveSidePanel>
      )}
    </div>
  )
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'border px-2.5 py-1 transition-colors',
        active ? 'border-ink bg-ink text-card' : 'border-border text-muted hover:border-ink hover:text-ink',
      )}
    >
      {label}
    </button>
  )
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex flex-col items-center justify-center border border-dashed border-border px-6 py-16 text-center">
      <Search className="mb-3 h-8 w-8 text-muted" />
      <div className="text-base font-medium text-ink">{title}</div>
      <div className="mt-1 text-sm text-muted">{detail}</div>
    </div>
  )
}

function renderHighlightedText(result: SearchResult) {
  const text = result.turn.canonical_text
  if (result.match_highlights.length === 0) {
    return text
  }

  const parts: Array<{ text: string; highlight: boolean }> = []
  let cursor = 0
  for (const highlight of result.match_highlights) {
    if (highlight.start > cursor) {
      parts.push({ text: text.slice(cursor, highlight.start), highlight: false })
    }
    parts.push({ text: text.slice(highlight.start, highlight.end), highlight: true })
    cursor = highlight.end
  }
  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), highlight: false })
  }

  return parts.map((part, index) =>
    part.highlight ? (
      <mark key={index} className="bg-candidate/25 px-0.5 text-ink">
        {part.text}
      </mark>
    ) : (
      <span key={index}>{part.text}</span>
    ),
  )
}

function summarizeTurnId(turnId: string) {
  const suffix = turnId.replace(/^turn-/, '')
  return `#${suffix.slice(0, 8)}`
}
