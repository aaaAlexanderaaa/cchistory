'use client'

import { useMemo, useState } from 'react'
import { useSWRConfig } from 'swr'
import { cn } from '@/lib/utils'
import { SessionMap } from '@/components/session-map'
import { TurnCard } from '@/components/turn-card'
import { TurnDetailPanel } from '@/components/turn-detail-panel'
import { ResponsiveSidePanel } from '@/components/responsive-side-panel'
import { SummaryPill } from '@/components/summary-pill'
import type { ProjectIdentity } from '@/lib/types'
import {
  createProjectStub,
  upsertLinkingOverride,
  useLinkingReviewQuery,
  useProjectsQuery,
  useSessionsQuery,
  useSessionQuery,
  useTurnContextQuery,
  useTurnQuery,
  useTurnsQuery,
} from '@/lib/api'
import {
  RefreshCw,
  Grid,
  List,
  ArrowUpDown,
  Archive,
  GitBranch,
  FolderOpen,
} from 'lucide-react'

type InboxTab = 'unlinked' | 'candidates' | 'archive'
type ViewMode = 'grid' | 'list' | 'sessions'
type SortMode = 'newest' | 'oldest'

export function InboxView() {
  const { data: turns = [], error: turnsError } = useTurnsQuery()
  const { data: review, error: reviewError } = useLinkingReviewQuery()
  const { data: projects = [] } = useProjectsQuery('all')
  const { data: sessions = [] } = useSessionsQuery()
  const { mutate } = useSWRConfig()
  const apiError = turnsError || reviewError
  const [activeTab, setActiveTab] = useState<InboxTab>('unlinked')
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [sortMode, setSortMode] = useState<SortMode>('newest')

  const projectRegistry = useMemo(() => {
    const registry = new Map<string, ProjectIdentity>()
    for (const project of projects) {
      registry.set(project.id, project)
    }
    for (const turn of turns) {
      if (turn.project_id && !registry.has(turn.project_id)) {
        registry.set(turn.project_id, createProjectStub(turn.project_id))
      }
    }
    return registry
  }, [projects, turns])
  const sessionRegistry = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  )

  const unlinkedTurns = review?.unlinked_turns ?? []
  const candidateTurns = review?.candidate_turns ?? []
  const archivedTurns = useMemo(() => turns.filter((turn) => turn.value_axis === 'archived'), [turns])
  const effectiveTab: InboxTab =
    activeTab === 'unlinked' && unlinkedTurns.length === 0 && candidateTurns.length > 0
      ? 'candidates'
      : activeTab
  const currentTurns =
    effectiveTab === 'unlinked'
      ? unlinkedTurns
      : effectiveTab === 'candidates'
        ? candidateTurns
        : archivedTurns
  const sortedTurns = useMemo(() => {
    const nextTurns = [...currentTurns]
    nextTurns.sort((left, right) =>
      sortMode === 'newest'
        ? right.created_at.getTime() - left.created_at.getTime()
        : left.created_at.getTime() - right.created_at.getTime(),
    )
    return nextTurns
  }, [currentTurns, sortMode])

  const selectedTurnSummary = useMemo(
    () => sortedTurns.find((turn) => turn.id === selectedTurnId) ?? turns.find((turn) => turn.id === selectedTurnId) ?? null,
    [sortedTurns, selectedTurnId, turns],
  )

  const { data: selectedTurnDetail } = useTurnQuery(selectedTurnSummary?.id ?? undefined)
  const selectedTurn = selectedTurnDetail ?? selectedTurnSummary
  const { data: selectedContext } = useTurnContextQuery(selectedTurn?.id)
  const { data: selectedSession } = useSessionQuery(selectedTurn?.session_id)
  const selectedProject = selectedTurn?.project_id
    ? projectRegistry.get(selectedTurn.project_id) ?? createProjectStub(selectedTurn.project_id)
    : undefined

  const handleLink = async (turnId: string, projectId: string) => {
    await upsertLinkingOverride({
      target_kind: 'turn',
      target_ref: turnId,
      project_id: projectId,
      display_name: projectRegistry.get(projectId)?.name,
    })
    await refreshInbox()
  }

  const refreshInbox = async () => {
    await Promise.all([
      mutate('/api/turns'),
      mutate('/api/sessions'),
      mutate('/api/projects?state=all'),
      mutate('/api/admin/linking'),
    ])
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className={cn('flex-1 flex flex-col overflow-hidden', selectedTurn && 'lg:border-r lg:border-border')}>
        <header className="flex-shrink-0 border-b border-border bg-card">
          <div className="flex flex-col gap-3 px-4 py-3 sm:px-6 xl:flex-row xl:items-center xl:justify-between">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-3">
                <span className="border border-warning/20 bg-warning/10 px-2 py-1 text-[10px] stamp-text text-warning">
                  TRIAGE
                </span>
                <h1 className="text-lg font-bold font-display text-ink">Inbox</h1>
                <span className="text-sm text-muted">{sortedTurns.length} in view</span>
              </div>
              <div className="text-xs text-muted">
                Review and link turns to projects. Unlinked turns need your attention.
              </div>
            </div>

            <button
              type="button"
              onClick={() => void refreshInbox()}
              className="flex items-center gap-2 border border-border px-3 py-1.5 text-sm transition-colors hover:border-ink"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>

          <div className="border-t border-border bg-paper px-4 py-3 sm:px-6">
            <div className="mb-2 text-[10px] stamp-text text-muted">QUEUE OVERVIEW</div>
            <div className="flex flex-wrap items-center gap-2">
              <SummaryPill label="In View" value={String(sortedTurns.length)} />
              <SummaryPill
                label="Pending"
                value={String(unlinkedTurns.length + candidateTurns.length)}
                tone={unlinkedTurns.length + candidateTurns.length > 0 ? 'warning' : 'normal'}
              />
              <SummaryPill label="Unlinked" value={String(unlinkedTurns.length)} tone={unlinkedTurns.length > 0 ? 'warning' : 'normal'} />
              <SummaryPill
                label="Candidates"
                value={String(candidateTurns.length)}
                tone={candidateTurns.length > 0 ? 'candidate' : 'normal'}
              />
              <SummaryPill label="Archived" value={String(archivedTurns.length)} />
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-border bg-paper px-4 py-3 sm:px-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-2">
              <div className="text-[10px] stamp-text text-muted">QUEUE</div>
              <div className="flex flex-wrap items-center gap-4 sm:gap-6">
                <button
                  type="button"
                  onClick={() => setActiveTab('unlinked')}
                  disabled={unlinkedTurns.length === 0}
                  className={cn(
                    'flex items-center gap-2 border-b-2 py-2 text-sm transition-colors',
                    effectiveTab === 'unlinked'
                      ? 'border-warning text-ink font-medium'
                      : 'border-transparent text-muted hover:text-ink disabled:cursor-default disabled:text-muted/50',
                  )}
                >
                  Unlinked
                  <span
                    className={cn(
                      'px-1.5 py-0.5 text-[10px] mono-text',
                      effectiveTab === 'unlinked' ? 'bg-warning text-white' : 'bg-surface-hover',
                    )}
                  >
                    {unlinkedTurns.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('candidates')}
                  className={cn(
                    'flex items-center gap-2 border-b-2 py-2 text-sm transition-colors',
                    effectiveTab === 'candidates'
                      ? 'border-warning text-ink font-medium'
                      : 'border-transparent text-muted hover:text-ink',
                  )}
                >
                  Candidates
                  <span
                    className={cn(
                      'px-1.5 py-0.5 text-[10px] mono-text',
                      effectiveTab === 'candidates' ? 'bg-candidate text-white' : 'bg-surface-hover',
                    )}
                  >
                    {candidateTurns.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('archive')}
                  className={cn(
                    'border-b-2 py-2 text-sm transition-colors',
                    effectiveTab === 'archive'
                      ? 'border-warning text-ink font-medium'
                      : 'border-transparent text-muted hover:text-ink',
                  )}
                >
                  Archive
                </button>
              </div>
            </div>

            <div className="space-y-2 xl:text-right">
              <div className="text-[10px] stamp-text text-muted">VIEW</div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center xl:justify-end">
                {viewMode !== 'sessions' && (
                  <div className="flex items-center gap-2">
                    <ArrowUpDown className="h-4 w-4 text-muted" />
                    <select
                      value={sortMode}
                      onChange={(event) => setSortMode(event.target.value as SortMode)}
                      className="min-w-0 flex-1 border border-border bg-transparent px-2 py-1 text-sm text-text focus:border-ink focus:outline-none sm:flex-none"
                    >
                      <option value="newest">Newest</option>
                      <option value="oldest">Oldest</option>
                    </select>
                  </div>
                )}

                <div className="ml-auto flex items-center border border-border sm:ml-0">
                  <button
                    type="button"
                    onClick={() => setViewMode('grid')}
                    className={cn(
                      'p-1.5 transition-colors',
                      viewMode === 'grid' ? 'bg-ink text-card' : 'text-muted hover:text-ink',
                    )}
                  >
                    <Grid className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('list')}
                    className={cn(
                      'p-1.5 transition-colors',
                      viewMode === 'list' ? 'bg-ink text-card' : 'text-muted hover:text-ink',
                    )}
                  >
                    <List className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('sessions')}
                    className={cn(
                      'p-1.5 transition-colors',
                      viewMode === 'sessions' ? 'bg-ink text-card' : 'text-muted hover:text-ink',
                    )}
                    title="Session Map"
                  >
                    <GitBranch className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </header>

        {selectedTurn && (
          <div className="border-b border-border bg-paper px-4 py-3 sm:px-6">
            <div className="mb-2 text-[10px] stamp-text text-muted">QUICK LINK SELECTED TURN</div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => void handleLink(selectedTurn.id, project.id)}
                  className="flex min-w-[11rem] items-center gap-2 border border-border bg-card px-3 py-2 text-left transition-colors hover:border-ink"
                >
                  <FolderOpen className="h-3.5 w-3.5 text-muted" />
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: project.color }} />
                  <span className="truncate text-sm text-ink">{project.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {apiError && (
            <div className="mb-4 border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
              Could not load data from the API. Make sure the API server is running (pnpm services:start).
            </div>
          )}
          {viewMode === 'sessions' ? (
            <SessionMap
              turns={sortedTurns}
              sessionRegistry={sessionRegistry}
              projectRegistry={projectRegistry}
              selectedTurnId={selectedTurn?.id}
              showOverview={false}
              onTurnSelect={(turn) => setSelectedTurnId(turn.id)}
            />
          ) : (
            <div
              className={cn(
                viewMode === 'grid'
                  ? 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
                  : 'max-w-4xl space-y-2',
              )}
            >
              {sortedTurns.map((turn) => {
                const project = turn.project_id ? projectRegistry.get(turn.project_id) : undefined

                return (
                  <div key={turn.id}>
                    <TurnCard
                      turn={turn}
                      session={sessionRegistry.get(turn.session_id)}
                      projectColor={project?.color}
                      variant="inbox"
                      selected={selectedTurn?.id === turn.id}
                      onClick={() => setSelectedTurnId(turn.id)}
                    />
                  </div>
                )
              })}
            </div>
          )}

          {viewMode !== 'sessions' && sortedTurns.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="mb-4 flex h-20 w-20 items-center justify-center border-2 border-dashed border-border">
                <Archive className="h-8 w-8 text-muted" />
              </div>
              <p className="mb-2 text-lg font-display text-ink">Inbox Cleared</p>
              <p className="text-sm text-muted">No turns match the current inbox tab.</p>
            </div>
          )}
        </div>
      </div>

      {selectedTurn && (
        <ResponsiveSidePanel onDismiss={() => setSelectedTurnId(null)} className="lg:w-[500px] lg:flex-shrink-0">
          <TurnDetailPanel
            turn={selectedTurn}
            context={selectedContext}
            session={selectedSession}
            project={selectedProject}
            onClose={() => setSelectedTurnId(null)}
            className="h-full lg:w-[500px] lg:flex-shrink-0"
          />
        </ResponsiveSidePanel>
      )}
    </div>
  )
}
