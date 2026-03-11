'use client'

import dynamic from 'next/dynamic'
import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { TurnListVirtual } from '@/components/turn-list-virtual'
import { ResponsiveSidePanel } from '@/components/responsive-side-panel'
import type { ProjectIdentity, UserTurn, LinkState, ValueAxis } from '@/lib/types'
import {
  createProjectStub,
  getApiBaseUrl,
  useProjectsQuery,
  useSessionsQuery,
  useSessionQuery,
  useTurnQuery,
  useTurnContextQuery,
  useTurnsQuery,
} from '@/lib/api'
import { AlertCircle, ArrowUpDown, Filter } from 'lucide-react'

const TurnDetailPanel = dynamic(
  () => import('@/components/turn-detail-panel').then((module) => module.TurnDetailPanel),
  { loading: () => <SidePanelLoading label="Loading turn..." /> },
)
const SessionDetailPanel = dynamic(
  () => import('@/components/session-detail-panel').then((module) => module.SessionDetailPanel),
  { loading: () => <SidePanelLoading label="Loading session..." /> },
)
const SessionMap = dynamic(
  () => import('@/components/session-map').then((module) => module.SessionMap),
  {
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-muted">Loading session map...</div>
    ),
  },
)

type SortOption = 'newest' | 'oldest' | 'project'
type DetailMode = 'turn' | 'session'
type ViewMode = 'turns' | 'sessions'

interface FilterState {
  projectId?: string
  linkStates: LinkState[]
  valueAxes: ValueAxis[]
}

export function AllTurnsView() {
  const { data: turns = [], error, isLoading } = useTurnsQuery()
  const { data: projects = [] } = useProjectsQuery('all')
  const { data: sessions = [] } = useSessionsQuery()
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null)
  const [detailMode, setDetailMode] = useState<DetailMode>('turn')
  const [viewMode, setViewMode] = useState<ViewMode>('turns')
  const [sortBy, setSortBy] = useState<SortOption>('newest')
  const [filters, setFilters] = useState<FilterState>({
    linkStates: ['committed', 'candidate', 'unlinked'],
    valueAxes: ['active'],
  })

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

  const projectOptions = useMemo(
    () => [...projectRegistry.values()].sort((left, right) => left.name.localeCompare(right.name)),
    [projectRegistry],
  )
  const sessionRegistry = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  )

  const filteredTurns = useMemo(() => {
    let nextTurns = [...turns]

    if (filters.projectId) {
      nextTurns = nextTurns.filter((turn) => turn.project_id === filters.projectId)
    }

    if (filters.linkStates.length < 3) {
      nextTurns = nextTurns.filter((turn) => filters.linkStates.includes(turn.link_state))
    }

    if (filters.valueAxes.length > 0) {
      nextTurns = nextTurns.filter((turn) => filters.valueAxes.includes(turn.value_axis))
    }

    nextTurns.sort((left, right) => {
      if (sortBy === 'newest') {
        return right.created_at.getTime() - left.created_at.getTime()
      }
      if (sortBy === 'oldest') {
        return left.created_at.getTime() - right.created_at.getTime()
      }
      const projectA = left.project_id ? projectRegistry.get(left.project_id)?.name ?? left.project_id : ''
      const projectB = right.project_id ? projectRegistry.get(right.project_id)?.name ?? right.project_id : ''
      return projectA.localeCompare(projectB)
    })

    return nextTurns
  }, [filters, projectRegistry, sortBy, turns])

  const selectedTurnSummary = useMemo(
    () => filteredTurns.find((turn) => turn.id === selectedTurnId) ?? turns.find((turn) => turn.id === selectedTurnId) ?? null,
    [filteredTurns, selectedTurnId, turns],
  )
  const { data: selectedTurnDetail } = useTurnQuery(selectedTurnSummary?.id ?? undefined)
  const selectedTurn = selectedTurnDetail ?? selectedTurnSummary
  const { data: selectedContext } = useTurnContextQuery(selectedTurn?.id)
  const { data: selectedSession } = useSessionQuery(selectedTurn?.session_id)
  const selectedProject = selectedTurn?.project_id
    ? projectRegistry.get(selectedTurn.project_id) ?? createProjectStub(selectedTurn.project_id)
    : undefined
  const selectedSessionTurns = useMemo(() => {
    if (!selectedSession) {
      return []
    }
    return turns
      .filter((turn) => turn.session_id === selectedSession.id)
      .sort((left, right) => left.created_at.getTime() - right.created_at.getTime())
  }, [selectedSession, turns])
  const panelMode = selectedTurn ? detailMode : 'turn'

  const toggleLinkState = (state: LinkState) => {
    setFilters((previous) => ({
      ...previous,
      linkStates: previous.linkStates.includes(state)
        ? previous.linkStates.filter((value) => value !== state)
        : [...previous.linkStates, state],
    }))
  }

  const toggleValueAxis = (axis: ValueAxis) => {
    setFilters((previous) => ({
      ...previous,
      valueAxes: previous.valueAxes.includes(axis)
        ? previous.valueAxes.filter((value) => value !== axis)
        : [...previous.valueAxes, axis],
    }))
  }

  const stats = useMemo(() => {
    const committed = turns.filter((turn) => turn.link_state === 'committed').length
    const candidate = turns.filter((turn) => turn.link_state === 'candidate').length
    const unlinked = turns.filter((turn) => turn.link_state === 'unlinked').length
    return { committed, candidate, unlinked, total: turns.length }
  }, [turns])

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-md border border-warning/30 bg-warning/5 p-5 text-sm text-text">
          <div className="flex items-center gap-2 mb-2 text-warning">
            <AlertCircle className="w-4 h-4" />
            <h1 className="text-base font-bold font-display text-ink">All Turns unavailable</h1>
          </div>
          <p className="mb-3">The web app could not reach the local API.</p>
          <div className="space-y-1 text-xs mono-text text-muted">
            <div>API base: {getApiBaseUrl()}</div>
            <div>Start API: pnpm --filter @cchistory/api dev</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="flex-shrink-0 border-b border-border bg-card px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-bold font-display text-ink">All Turns</h1>
              <span className="text-sm text-muted">
                {isLoading ? 'Loading…' : `${filteredTurns.length} / ${stats.total}`}
              </span>
            </div>
            <div className="text-xs text-muted">
              Canonical `UserTurn` feed. Session remains a provenance projection.
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex w-full items-center border border-border sm:w-auto">
              <button
                type="button"
                onClick={() => setViewMode('turns')}
                className={cn(
                  'flex-1 px-3 py-1.5 text-sm transition-colors sm:flex-none',
                  viewMode === 'turns' ? 'bg-ink text-card' : 'text-muted hover:text-ink',
                )}
              >
                Turn Stream
              </button>
              <button
                type="button"
                onClick={() => setViewMode('sessions')}
                className={cn(
                  'flex-1 px-3 py-1.5 text-sm transition-colors sm:flex-none',
                  viewMode === 'sessions' ? 'bg-ink text-card' : 'text-muted hover:text-ink',
                )}
              >
                Session Map
              </button>
            </div>
            {viewMode === 'turns' && (
              <div className="flex items-center gap-2">
                <ArrowUpDown className="h-4 w-4 text-muted" />
                <select
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value as SortOption)}
                  className="min-w-0 flex-1 border border-border bg-transparent px-2 py-1 text-sm text-text focus:border-ink focus:outline-none sm:flex-none"
                >
                  <option value="newest">Newest First</option>
                  <option value="oldest">Oldest First</option>
                  <option value="project">By Project</option>
                </select>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex-shrink-0 flex flex-wrap items-center gap-4 border-b border-border bg-paper px-4 py-2 sm:px-6">
        <Filter className="h-4 w-4 text-muted" />

        <select
          value={filters.projectId || ''}
          onChange={(event) =>
            setFilters((previous) => ({ ...previous, projectId: event.target.value || undefined }))
          }
          className="min-w-[11rem] max-w-full flex-1 border border-border bg-transparent px-2 py-1 text-xs text-text focus:border-ink focus:outline-none sm:flex-none"
        >
          <option value="">All Projects</option>
          {projectOptions.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>

        <span className="hidden text-border sm:block">|</span>

        <div className="flex flex-wrap items-center gap-1">
          <FilterChip
            label="Committed"
            count={stats.committed}
            active={filters.linkStates.includes('committed')}
            color="success"
            onClick={() => toggleLinkState('committed')}
          />
          <FilterChip
            label="Candidate"
            count={stats.candidate}
            active={filters.linkStates.includes('candidate')}
            color="candidate"
            onClick={() => toggleLinkState('candidate')}
          />
          <FilterChip
            label="Unlinked"
            count={stats.unlinked}
            active={filters.linkStates.includes('unlinked')}
            color="muted"
            onClick={() => toggleLinkState('unlinked')}
          />
        </div>

        <span className="hidden text-border sm:block">|</span>

        <div className="flex flex-wrap items-center gap-1">
          <FilterChip
            label="Active"
            active={filters.valueAxes.includes('active')}
            onClick={() => toggleValueAxis('active')}
          />
          <FilterChip
            label="Archived"
            active={filters.valueAxes.includes('archived')}
            onClick={() => toggleValueAxis('archived')}
          />
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className={cn('flex-1 overflow-hidden transition-all', selectedTurn && 'lg:border-r lg:border-border')}>
          {viewMode === 'turns' ? (
            <TurnListVirtual
              turns={filteredTurns}
              selectedTurnId={selectedTurn?.id}
              onTurnSelect={(turn) => {
                setSelectedTurnId(turn.id)
                setDetailMode('turn')
              }}
              getSession={(sessionId) => sessionRegistry.get(sessionId)}
              getProject={(projectId) => projectRegistry.get(projectId)}
            />
          ) : (
            <SessionMap
              turns={filteredTurns}
              sessionRegistry={sessionRegistry}
              projectRegistry={projectRegistry}
              selectedTurnId={selectedTurn?.id}
              showOverview={false}
              onTurnSelect={(turn) => {
                setSelectedTurnId(turn.id)
                setDetailMode('turn')
              }}
            />
          )}
        </div>

        {selectedTurn && panelMode === 'turn' && (
          <ResponsiveSidePanel onDismiss={() => setSelectedTurnId(null)} className="lg:w-[34rem] lg:flex-shrink-0 xl:w-[38rem]">
            <TurnDetailPanel
              key={selectedTurn.id}
              turn={selectedTurn}
              context={selectedContext}
              session={selectedSession}
              project={selectedProject}
              onOpenSession={() => {
                if (selectedSession) {
                  setDetailMode('session')
                }
              }}
              onClose={() => setSelectedTurnId(null)}
              className="h-full lg:w-[34rem] lg:flex-shrink-0 xl:w-[38rem]"
            />
          </ResponsiveSidePanel>
        )}

        {selectedTurn && selectedSession && panelMode === 'session' && (
          <ResponsiveSidePanel onDismiss={() => setSelectedTurnId(null)} className="lg:w-[34rem] lg:flex-shrink-0 xl:w-[38rem]">
            <SessionDetailPanel
              key={selectedSession.id}
              session={selectedSession}
              turns={selectedSessionTurns}
              selectedTurnId={selectedTurn.id}
              project={
                selectedSession.primary_project_id
                  ? projectRegistry.get(selectedSession.primary_project_id) ??
                    createProjectStub(selectedSession.primary_project_id)
                  : selectedProject
              }
              onBack={() => setDetailMode('turn')}
              onClose={() => setSelectedTurnId(null)}
              onSelectTurn={(turnId) => {
                setSelectedTurnId(turnId)
                setDetailMode('turn')
              }}
              className="h-full lg:w-[34rem] lg:flex-shrink-0 xl:w-[38rem]"
            />
          </ResponsiveSidePanel>
        )}
      </div>
    </div>
  )
}

function SidePanelLoading({ label }: { label: string }) {
  return <div className="flex h-full items-center justify-center p-6 text-sm text-muted">{label}</div>
}

interface FilterChipProps {
  label: string
  count?: number
  active: boolean
  color?: 'success' | 'candidate' | 'muted' | 'default'
  onClick: () => void
}

function FilterChip({ label, count, active, color = 'default', onClick }: FilterChipProps) {
  const colorClasses = {
    success: active ? 'bg-success/10 text-success border-success/30' : 'text-muted border-border',
    candidate: active ? 'bg-candidate/10 text-candidate border-candidate/30' : 'text-muted border-border',
    muted: active ? 'bg-muted/10 text-text border-muted/30' : 'text-muted border-border',
    default: active ? 'bg-ink text-card border-ink' : 'text-muted border-border',
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-2 py-0.5 text-[10px] stamp-text border transition-colors',
        colorClasses[color],
        !active && 'hover:border-ink hover:text-ink',
      )}
    >
      {label}
      {count !== undefined && <span className="ml-1 mono-text font-normal">{count}</span>}
    </button>
  )
}
