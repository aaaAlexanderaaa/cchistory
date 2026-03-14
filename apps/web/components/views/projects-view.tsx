'use client'

import { createElement, type ComponentProps } from 'react'
import { useMemo, useState } from 'react'
import {
  formatTokenUsageOverview,
  formatTokenValue,
  summarizeTurnsTokenUsage,
} from '@/lib/token-usage'
import { cn, formatAbsoluteDateTime, formatRelativeTime } from '@/lib/utils'
import { formatSourcePlatform, SessionBadge } from '@/components/session-badge'
import { SessionMap } from '@/components/session-map'
import { TurnDetailPanel } from '@/components/turn-detail-panel'
import { ResponsiveSidePanel } from '@/components/responsive-side-panel'
import type { ProjectIdentity, Session, UserTurn } from '@/lib/types'
import {
  createProjectStub,
  useProjectsQuery,
  useProjectRevisionsQuery,
  useProjectTurnsQuery,
  useSessionsQuery,
  useSessionQuery,
  useTurnContextQuery,
  useTurnQuery,
  useTurnsQuery,
} from '@/lib/api'
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  FolderOpen,
  FolderTree,
  GitBranch,
  Link2,
} from 'lucide-react'

type ProjectViewMode = 'list' | 'detail'
type TurnTab = 'committed' | 'candidates'
type DetailContentMode = 'turns' | 'sessions'
type ProjectTurnLayout = 'rows' | 'cards' | 'waterfall'
type OverviewMode = 'grid' | 'sessions'
type ProjectSort = 'activity' | 'name' | 'turns'
type ProjectTurnSort = 'newest' | 'oldest'

export function ProjectsView() {
  const { data: projects = [] } = useProjectsQuery('all')
  const { data: turns = [] } = useTurnsQuery()
  const { data: sessions = [] } = useSessionsQuery()
  const [viewMode, setViewMode] = useState<ProjectViewMode>('list')
  const [overviewMode, setOverviewMode] = useState<OverviewMode>('grid')
  const [projectSort, setProjectSort] = useState<ProjectSort>('activity')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TurnTab>('committed')
  const turnsByProjectId = useMemo(() => {
    const registry = new Map<string, UserTurn[]>()
    for (const turn of turns) {
      if (!turn.project_id) {
        continue
      }
      const current = registry.get(turn.project_id)
      if (current) {
        current.push(turn)
      } else {
        registry.set(turn.project_id, [turn])
      }
    }
    return registry
  }, [turns])

  const projectRegistry = useMemo(() => {
    const registry = new Map<string, ProjectIdentity>()
    for (const project of projects) {
      registry.set(project.id, project)
    }
    return registry
  }, [projects])
  const sessionRegistry = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  )

  const selectedProject = selectedProjectId ? projectRegistry.get(selectedProjectId) ?? null : null
  const allProjectTurns = useMemo(
    () => (selectedProjectId ? turns.filter((turn) => turn.project_id === selectedProjectId) : []),
    [selectedProjectId, turns],
  )
  const linkedTurns = useMemo(() => turns.filter((turn) => Boolean(turn.project_id)), [turns])
  const sortedProjects = useMemo(() => {
    const items = [...projects]
    items.sort((left, right) => {
      if (projectSort === 'name') {
        return left.name.localeCompare(right.name)
      }
      if (projectSort === 'turns') {
        return (right.committed_turn_count + right.candidate_turn_count) - (left.committed_turn_count + left.candidate_turn_count)
      }
      return right.last_activity.getTime() - left.last_activity.getTime()
    })
    return items
  }, [projectSort, projects])
  const { data: committedTurns = [] } = useProjectTurnsQuery(selectedProjectId ?? undefined, 'committed')
  const { data: candidateTurns = [] } = useProjectTurnsQuery(selectedProjectId ?? undefined, 'candidate')
  const { data: revisionsData } = useProjectRevisionsQuery(selectedProjectId ?? undefined)
  const currentTurns = activeTab === 'committed' ? committedTurns : candidateTurns

  const selectedTurnSummary = useMemo(
    () =>
      currentTurns.find((turn) => turn.id === selectedTurnId) ??
      allProjectTurns.find((turn) => turn.id === selectedTurnId) ??
      turns.find((turn) => turn.id === selectedTurnId) ??
      null,
    [allProjectTurns, currentTurns, selectedTurnId, turns],
  )
  const { data: selectedTurnDetail } = useTurnQuery(selectedTurnSummary?.id ?? undefined)
  const selectedTurn = selectedTurnDetail ?? selectedTurnSummary
  const { data: selectedContext } = useTurnContextQuery(selectedTurn?.id)
  const { data: selectedSession } = useSessionQuery(selectedTurn?.session_id)
  const selectedTurnProject = selectedTurn?.project_id
    ? projectRegistry.get(selectedTurn.project_id) ?? createProjectStub(selectedTurn.project_id)
    : selectedProject ?? undefined

  const handleProjectClick = (projectId: string) => {
    const project = projectRegistry.get(projectId)
    setSelectedProjectId(projectId)
    setViewMode('detail')
    setActiveTab(project?.linkage_state === 'candidate' ? 'candidates' : 'committed')
    setSelectedTurnId(null)
  }

  const handleBack = () => {
    setSelectedProjectId(null)
    setViewMode('list')
    setSelectedTurnId(null)
  }

  if (viewMode === 'detail' && selectedProject) {
    return (
      <ProjectDetailView
        key={`${selectedProject.id}:${activeTab}`}
        project={selectedProject}
        turns={committedTurns}
        candidates={candidateTurns}
        allProjectTurns={allProjectTurns}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        selectedTurn={selectedTurn}
        selectedContext={selectedContext}
        selectedSession={selectedSession}
        selectedTurnProject={selectedTurnProject}
        revisionsCount={revisionsData?.revisions.length ?? 0}
        projectRegistry={projectRegistry}
        sessionRegistry={sessionRegistry}
        onSelectTurn={setSelectedTurnId}
        onBack={handleBack}
      />
    )
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className={cn('flex min-w-0 flex-1 flex-col overflow-hidden', selectedTurn && overviewMode === 'sessions' && 'lg:border-r lg:border-border')}>
        <header className="border-b border-border bg-card">
          <div className="flex flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-lg font-bold font-display text-ink">Projects</h1>
                <span className="text-sm text-muted">{projects.length} linked identities</span>
              </div>
              <div className="text-xs text-muted">
                Project is the context boundary. `UserTurn` remains the recall unit.
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {overviewMode === 'grid' && (
                <select
                  value={projectSort}
                  onChange={(event) => setProjectSort(event.target.value as ProjectSort)}
                  className="border border-border bg-card px-2 py-1.5 text-sm text-text focus:border-ink focus:outline-none"
                >
                  <option value="activity">Recent Activity</option>
                  <option value="turns">Most Turns</option>
                  <option value="name">Name</option>
                </select>
              )}
              <div className="flex w-full items-center border border-border sm:w-auto">
                <button
                  type="button"
                  onClick={() => setOverviewMode('grid')}
                  className={cn(
                    'flex-1 px-3 py-1.5 text-sm transition-colors sm:flex-none',
                    overviewMode === 'grid' ? 'bg-ink text-card' : 'text-muted hover:text-ink',
                  )}
                >
                  Project Grid
                </button>
                <button
                  type="button"
                  onClick={() => setOverviewMode('sessions')}
                  className={cn(
                    'flex-1 px-3 py-1.5 text-sm transition-colors sm:flex-none',
                    overviewMode === 'sessions' ? 'bg-ink text-card' : 'text-muted hover:text-ink',
                  )}
                >
                  Session Map
                </button>
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {overviewMode === 'grid' ? (
            <div className="grid auto-rows-fr grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {sortedProjects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  turns={turnsByProjectId.get(project.id) ?? []}
                  onClick={() => handleProjectClick(project.id)}
                />
              ))}
            </div>
          ) : (
            <SessionMap
              turns={linkedTurns}
              sessionRegistry={sessionRegistry}
              projectRegistry={projectRegistry}
              selectedTurnId={selectedTurn?.id}
              defaultAxisMode="session"
              showOverview={false}
              onTurnSelect={(turn) => setSelectedTurnId(turn.id)}
            />
          )}
        </div>
      </div>

      {selectedTurn && overviewMode === 'sessions' && (
        <ResponsiveSidePanel onDismiss={() => setSelectedTurnId(null)} className="lg:w-[500px] lg:flex-shrink-0">
          <TurnDetailPanel
            turn={selectedTurn}
            context={selectedContext}
            session={selectedSession}
            project={selectedTurnProject}
            onClose={() => setSelectedTurnId(null)}
            className="h-full lg:w-[500px] lg:flex-shrink-0"
          />
        </ResponsiveSidePanel>
      )}
    </div>
  )
}

interface ProjectCardProps {
  project: ProjectIdentity
  turns: UserTurn[]
  onClick: () => void
}

function ProjectCard({ project, turns, onClick }: ProjectCardProps) {
  const hasStale = turns.some((turn) => turn.sync_axis === 'superseded' || turn.sync_axis === 'source_absent')
  const metrics = summarizeTurnMetrics(turns)
  const sessionCount = countUniqueSessions(turns)
  const evidenceLabel =
    project.primary_workspace_path ?? project.primary_repo_remote ?? 'No workspace or repo evidence yet'
  const evidenceIcon = project.primary_workspace_path ? FolderTree : project.primary_repo_remote ? GitBranch : Link2

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-full cursor-pointer flex-col overflow-hidden border border-border bg-card text-left shadow-hard transition-colors hover:bg-surface-hover"
    >
      <div className="border-b border-border px-4 py-3">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <div className="h-3 w-3" style={{ backgroundColor: project.color }} />
              <ProjectStateBadge project={project} />
            </div>
            <h3 className="font-display text-lg font-semibold text-ink">{project.name}</h3>
            {project.description && <p className="mt-1 text-xs text-muted line-clamp-2">{project.description}</p>}
          </div>

          <div className="flex h-8 w-8 items-center justify-center border border-border bg-card">
            {!hasStale ? (
              <CheckCircle2 className="h-4 w-4 text-success" />
            ) : (
              <AlertCircle className="h-4 w-4 text-warning" />
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[10px] stamp-text">
          <span className="border border-border bg-card px-2 py-1 text-muted">
            {formatLinkReason(project.link_reason)}
          </span>
          <span className="border border-border bg-card px-2 py-1 text-muted">
            {sessionCount} sessions
          </span>
          <span className="border border-border bg-card px-2 py-1 text-muted">
            Updated {formatRelativeTime(project.last_activity)}
          </span>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-3">
        <div className="grid grid-cols-2 gap-2">
          <CompactProjectMetric label="Committed" value={String(project.committed_turn_count)} tone="success" />
          <CompactProjectMetric label="Candidates" value={String(project.candidate_turn_count)} tone="candidate" />
          <CompactProjectMetric label="Active" value={formatDurationCompact(metrics.activeDurationMs)} />
          <CompactProjectMetric label="Tokens" value={formatTokenValue(metrics.tokenUsage?.total_tokens)} />
        </div>

        <div className="flex items-start gap-2 text-xs text-muted">
          {createElement(evidenceIcon, { className: 'mt-0.5 h-3.5 w-3.5 flex-shrink-0' })}
          <span className={cn(project.primary_workspace_path && 'mono-text break-all', !project.primary_workspace_path && 'break-all')}>
            {evidenceLabel}
          </span>
        </div>
      </div>
    </button>
  )
}

interface ProjectDetailViewProps {
  project: ProjectIdentity
  turns: UserTurn[]
  candidates: UserTurn[]
  allProjectTurns: UserTurn[]
  activeTab: TurnTab
  onTabChange: (tab: TurnTab) => void
  selectedTurn: UserTurn | null
  selectedContext: ComponentProps<typeof TurnDetailPanel>['context']
  selectedSession: ComponentProps<typeof TurnDetailPanel>['session']
  selectedTurnProject?: ProjectIdentity
  revisionsCount: number
  projectRegistry: Map<string, ProjectIdentity>
  sessionRegistry: Map<string, Session>
  onSelectTurn: (turnId: string | null) => void
  onBack: () => void
}

function ProjectDetailView({
  project,
  turns,
  candidates,
  allProjectTurns,
  activeTab,
  onTabChange,
  selectedTurn,
  selectedContext,
  selectedSession,
  selectedTurnProject,
  revisionsCount,
  projectRegistry,
  sessionRegistry,
  onSelectTurn,
  onBack,
}: ProjectDetailViewProps) {
  const currentTurns = activeTab === 'committed' ? turns : candidates
  const [contentMode, setContentMode] = useState<DetailContentMode>('turns')
  const [turnLayout, setTurnLayout] = useState<ProjectTurnLayout>('rows')
  const [turnSort, setTurnSort] = useState<ProjectTurnSort>('newest')
  const hasStale = allProjectTurns.some((turn) => turn.sync_axis === 'superseded' || turn.sync_axis === 'source_absent')
  const currentMetrics = summarizeTurnMetrics(currentTurns)
  const currentTokenSummary = formatTokenUsageOverview(
    currentMetrics.tokenUsage,
    currentMetrics.trackedTurns,
    currentMetrics.turns,
  )
  const projectSessionCount = countUniqueSessions(allProjectTurns)
  const sortedCurrentTurns = useMemo(() => {
    const items = [...currentTurns]
    items.sort((left, right) =>
      turnSort === 'newest'
        ? right.created_at.getTime() - left.created_at.getTime()
        : left.created_at.getTime() - right.created_at.getTime(),
    )
    return items
  }, [currentTurns, turnSort])

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className={cn('flex min-w-0 flex-1 flex-col overflow-hidden', selectedTurn && 'lg:border-r lg:border-border')}>
        <header className="border-b border-border bg-card">
          <div className="flex flex-col gap-3 px-4 py-3 sm:px-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={onBack}
                  className="border border-border bg-card p-1.5 transition-colors hover:bg-surface-hover"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <div className="h-3 w-3" style={{ backgroundColor: project.color }} />
                <h1 className="font-display text-[1.4rem] leading-tight text-ink">{project.name}</h1>
                {!hasStale ? (
                  <span className="flex items-center gap-1 border border-success/30 bg-success/10 px-2.5 py-1 text-xs text-success">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Healthy
                  </span>
                ) : (
                  <span className="flex items-center gap-1 border border-warning/30 bg-warning/10 px-2.5 py-1 text-xs text-warning">
                    <AlertCircle className="h-3.5 w-3.5" />
                    Needs attention
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted">
                <span className="border border-border bg-paper px-2.5 py-1">
                  {projectSessionCount || project.session_count} sessions
                </span>
                <span className="border border-border bg-paper px-2.5 py-1">
                  {allProjectTurns.length} total turns
                </span>
                <span className="border border-border bg-paper px-2.5 py-1">
                  {currentTurns.length} turns in view
                </span>
                <span className="border border-border bg-paper px-2.5 py-1">
                  {revisionsCount} revisions
                </span>
              </div>

              {project.description && <p className="max-w-3xl text-sm text-muted">{project.description}</p>}

              <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
                {project.primary_workspace_path && (
                  <span className="flex items-center gap-1.5">
                    <FolderTree className="h-3.5 w-3.5" />
                    <span className="mono-text break-all">{project.primary_workspace_path}</span>
                  </span>
                )}
                {project.primary_repo_remote && (
                  <span className="flex items-center gap-1.5">
                    <GitBranch className="h-3.5 w-3.5" />
                    <span className="break-all">{project.primary_repo_remote}</span>
                  </span>
                )}
                <span>{formatLinkReason(project.link_reason)}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-border bg-paper px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-4 sm:gap-6">
              <button
                type="button"
                onClick={() => onTabChange('committed')}
                className={cn(
                  'border-b-2 py-2 text-sm transition-colors',
                  activeTab === 'committed'
                    ? 'border-ink font-medium text-ink'
                    : 'border-transparent text-muted hover:text-ink',
                )}
              >
                Committed Turns
                <span className="ml-2 bg-card px-1.5 py-0.5 text-[10px] mono-text">{turns.length}</span>
              </button>

              <button
                type="button"
                onClick={() => onTabChange('candidates')}
                className={cn(
                  'border-b-2 py-2 text-sm transition-colors',
                  activeTab === 'candidates'
                    ? 'border-ink font-medium text-ink'
                    : 'border-transparent text-muted hover:text-ink',
                )}
              >
                Candidates
                {candidates.length > 0 && (
                  <span className="ml-2 bg-candidate/10 px-1.5 py-0.5 text-[10px] mono-text text-candidate">
                    {candidates.length}
                  </span>
                )}
              </button>
            </div>

            <div className="flex flex-col gap-2 lg:items-end">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                {contentMode === 'turns' && (
                  <>
                    <select
                      value={turnSort}
                      onChange={(event) => setTurnSort(event.target.value as ProjectTurnSort)}
                      className="border border-border bg-card px-2 py-1.5 text-sm text-text focus:border-ink focus:outline-none"
                    >
                      <option value="newest">Newest</option>
                      <option value="oldest">Oldest</option>
                    </select>

                    <div className="flex w-full items-center border border-border bg-card p-1 sm:w-auto">
                      <button
                        type="button"
                        onClick={() => setTurnLayout('rows')}
                        className={cn(
                          'flex-1 px-3 py-1.5 text-sm transition-colors sm:flex-none',
                          turnLayout === 'rows' ? 'bg-ink text-card' : 'text-muted hover:text-ink',
                        )}
                      >
                        Rows
                      </button>
                      <button
                        type="button"
                        onClick={() => setTurnLayout('cards')}
                        className={cn(
                          'flex-1 px-3 py-1.5 text-sm transition-colors sm:flex-none',
                          turnLayout === 'cards' ? 'bg-ink text-card' : 'text-muted hover:text-ink',
                        )}
                      >
                        Cards
                      </button>
                      <button
                        type="button"
                        onClick={() => setTurnLayout('waterfall')}
                        className={cn(
                          'flex-1 px-3 py-1.5 text-sm transition-colors sm:flex-none',
                          turnLayout === 'waterfall' ? 'bg-ink text-card' : 'text-muted hover:text-ink',
                        )}
                      >
                        Waterfall
                      </button>
                    </div>
                  </>
                )}
                <div className="flex w-full items-center border border-border bg-card p-1 sm:w-auto">
                  <button
                    type="button"
                    onClick={() => setContentMode('turns')}
                    className={cn(
                      'flex-1 px-3 py-1.5 text-sm transition-colors sm:flex-none',
                      contentMode === 'turns' ? 'bg-ink text-card' : 'text-muted hover:text-ink',
                    )}
                  >
                    Turn Stream
                  </button>
                  <button
                    type="button"
                    onClick={() => setContentMode('sessions')}
                    className={cn(
                      'flex-1 px-3 py-1.5 text-sm transition-colors sm:flex-none',
                      contentMode === 'sessions' ? 'bg-ink text-card' : 'text-muted hover:text-ink',
                    )}
                  >
                    Session Map
                  </button>
                </div>
              </div>

              <div className="text-xs text-muted">
                {contentMode === 'sessions'
                  ? `${currentMetrics.turns} turns across ${countUniqueSessions(currentTurns)} sessions in view · ${currentTokenSummary}`
                  : `${currentTokenSummary} in this view`}
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {contentMode === 'turns' ? (
            <div className={projectTurnLayoutClassName(turnLayout)}>
              {sortedCurrentTurns.map((turn) =>
                turnLayout === 'rows' ? (
                  <ProjectTurnRow
                    key={turn.id}
                    turn={turn}
                    session={sessionRegistry.get(turn.session_id)}
                    projectColor={project.color}
                    selected={selectedTurn?.id === turn.id}
                    onClick={() => onSelectTurn(turn.id)}
                  />
                ) : (
                  <div
                    key={turn.id}
                    className={cn(
                      turnLayout === 'cards' && 'h-full',
                      turnLayout === 'waterfall' && 'mb-4 break-inside-avoid',
                    )}
                  >
                    <ProjectTurnTile
                      turn={turn}
                      session={sessionRegistry.get(turn.session_id)}
                      projectColor={project.color}
                      layout={turnLayout}
                      selected={selectedTurn?.id === turn.id}
                      onClick={() => onSelectTurn(turn.id)}
                    />
                  </div>
                ),
              )}

              {currentTurns.length === 0 && (
                <div className="flex flex-col items-center justify-center border border-dashed border-border py-16">
                  <div className="mb-4 flex h-16 w-16 items-center justify-center border-2 border-dashed border-border">
                    <FolderOpen className="h-8 w-8 text-muted" />
                  </div>
                  <p className="text-muted">
                    {activeTab === 'committed' ? 'No committed turns yet' : 'No candidate turns pending'}
                  </p>
                  {activeTab === 'committed' && (
                    <span className="mt-4 text-sm text-muted">Use Admin → Linking to review candidate turns.</span>
                  )}
                </div>
              )}
            </div>
          ) : (
            <SessionMap
              turns={currentTurns}
              sessionRegistry={sessionRegistry}
              projectRegistry={projectRegistry}
              selectedTurnId={selectedTurn?.id}
              fixedAxisMode="shared"
              defaultSortBy="created"
              defaultSortDirection="asc"
              showOverview={false}
              hideProjectPathWhenRedundant
              onTurnSelect={(turn) => onSelectTurn(turn.id)}
            />
          )}
        </div>
      </div>

      {selectedTurn && (
        <ResponsiveSidePanel onDismiss={() => onSelectTurn(null)} className="lg:w-[500px] lg:flex-shrink-0">
          <TurnDetailPanel
            turn={selectedTurn}
            context={selectedContext}
            session={selectedSession}
            project={selectedTurnProject}
            onClose={() => onSelectTurn(null)}
            className="h-full lg:w-[500px] lg:flex-shrink-0"
          />
        </ResponsiveSidePanel>
      )}
    </div>
  )
}

function ProjectTurnRow({
  turn,
  session,
  projectColor,
  selected,
  onClick,
}: {
  turn: UserTurn
  session?: Session
  projectColor?: string
  selected: boolean
  onClick: () => void
}) {
  const tokenTotal = formatTokenValue(
    turn.context_summary.token_usage?.total_tokens ?? turn.context_summary.total_tokens,
  )
  const borderColor = projectColor || '#E0E0E0'

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'grid w-full gap-4 border border-border bg-card px-4 py-3 text-left shadow-hard transition-colors hover:bg-surface-hover xl:grid-cols-[15rem_minmax(0,1fr)_11rem]',
        selected && 'border-accent bg-paper shadow-hover',
      )}
      style={{
        borderLeftColor: borderColor,
        borderLeftWidth: '4px',
      }}
    >
      <div className="space-y-3 border-b border-dashed border-border/80 pb-3 xl:border-b-0 xl:border-r xl:pb-0 xl:pr-4">
        <div className="mono-text text-[10px] text-muted">
          {turn.id.toUpperCase().replace('TURN-', '#')}
        </div>
        <div className="text-xs text-muted">
          {formatAbsoluteDateTime(turn.created_at)} · {formatRelativeTime(turn.created_at)}
        </div>
        {session ? (
          <SessionBadge
            session={session}
            compact
            className="max-w-full bg-paper"
            showTurnCount={false}
          />
        ) : (
          <span className="inline-flex w-fit items-center border border-border bg-paper px-2 py-1 text-[10px] text-muted">
            Session unavailable
          </span>
        )}
        <div className="flex flex-wrap items-center gap-2 text-[10px] stamp-text text-muted">
          <span className="border border-border bg-paper px-2 py-1 mono-text">
            {formatSourcePlatform(session?.source_platform ?? 'other')}
          </span>
          <span className="border border-border bg-paper px-2 py-1">
            {turn.context_summary.assistant_reply_count} replies
          </span>
          {turn.context_summary.tool_call_count > 0 && (
            <span className="border border-border bg-paper px-2 py-1">
              {turn.context_summary.tool_call_count} tools
            </span>
          )}
        </div>
      </div>

      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {turnRowStatusChips(turn).map((chip) => (
            <span
              key={chip.label}
              className={cn(
                'inline-flex items-center gap-1 border px-1.5 py-0.5 text-[10px] stamp-text',
                chip.className,
              )}
            >
              {chip.label}
            </span>
          ))}
        </div>

        <p className="text-sm leading-6 text-ink">{turn.canonical_text}</p>

        {turn.tags && turn.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
            {turn.tags.slice(0, 4).map((tag) => (
              <span key={tag} className="border border-border bg-paper px-1.5 py-0.5">
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-dashed border-border/80 pt-3 text-left xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0 xl:text-right">
        <div className="text-[10px] stamp-text text-muted">Turn Stats</div>
        <div className="space-y-1 text-xs text-muted">
          <div>Active {formatRelativeTime(turn.last_context_activity_at)}</div>
          <div>Tokens {tokenTotal}</div>
          {turn.context_summary.primary_model && (
            <div className="truncate" title={turn.context_summary.primary_model}>
              {turn.context_summary.primary_model}
            </div>
          )}
        </div>
      </div>
    </button>
  )
}

function ProjectTurnTile({
  turn,
  session,
  projectColor,
  layout,
  selected,
  onClick,
}: {
  turn: UserTurn
  session?: Session
  projectColor?: string
  layout: Exclude<ProjectTurnLayout, 'rows'>
  selected: boolean
  onClick: () => void
}) {
  const tokenTotal = formatTokenValue(
    turn.context_summary.token_usage?.total_tokens ?? turn.context_summary.total_tokens,
  )
  const borderColor = projectColor || '#E0E0E0'

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-full w-full flex-col border border-border bg-card p-4 text-left shadow-hard transition-colors hover:bg-surface-hover',
        selected && 'border-accent bg-paper shadow-hover',
      )}
      style={{
        borderLeftColor: borderColor,
        borderLeftWidth: '4px',
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="mono-text text-[10px] text-muted">
            {turn.id.toUpperCase().replace('TURN-', '#')}
          </div>
          <div className="text-xs text-muted">
            {formatAbsoluteDateTime(turn.created_at)} · {formatRelativeTime(turn.created_at)}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {turnRowStatusChips(turn).map((chip) => (
            <span
              key={chip.label}
              className={cn(
                'inline-flex items-center gap-1 border px-1.5 py-0.5 text-[10px] stamp-text',
                chip.className,
              )}
            >
              {chip.label}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 flex-1 space-y-3">
        <div className="border border-border/70 bg-paper px-3 py-3">
          <p
            className={cn(
              'text-sm leading-6 text-ink',
              layout === 'cards' ? 'line-clamp-4' : 'line-clamp-6',
            )}
          >
            {turn.canonical_text}
          </p>
        </div>

        {turn.tags && turn.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
            {turn.tags.slice(0, layout === 'cards' ? 3 : 5).map((tag) => (
              <span key={tag} className="border border-border bg-paper px-1.5 py-0.5">
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 space-y-3 border-t border-border pt-3">
        {session ? (
          <SessionBadge
            session={session}
            compact
            className="max-w-full bg-paper"
            showTurnCount={false}
          />
        ) : (
          <span className="inline-flex w-fit items-center border border-border bg-paper px-2 py-1 text-[10px] text-muted">
            Session unavailable
          </span>
        )}

        <div className="flex flex-wrap items-center gap-2 text-[10px] stamp-text text-muted">
          <span className="border border-border bg-paper px-2 py-1 mono-text">
            {formatSourcePlatform(session?.source_platform ?? 'other')}
          </span>
          <span className="border border-border bg-paper px-2 py-1">
            {turn.context_summary.assistant_reply_count} replies
          </span>
          {turn.context_summary.tool_call_count > 0 && (
            <span className="border border-border bg-paper px-2 py-1">
              {turn.context_summary.tool_call_count} tools
            </span>
          )}
          <span className="border border-border bg-paper px-2 py-1">
            Tokens {tokenTotal}
          </span>
        </div>
      </div>
    </button>
  )
}

function CompactProjectMetric({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'success' | 'candidate'
}) {
  return (
    <div
      className={cn(
        'border px-3 py-2',
        tone === 'neutral' && 'border-border bg-paper text-ink',
        tone === 'success' && 'border-success/30 bg-success/10 text-success',
        tone === 'candidate' && 'border-candidate/30 bg-candidate/10 text-candidate',
      )}
    >
      <div className="text-[10px] stamp-text text-muted">{label}</div>
      <div className="mt-1 text-sm font-semibold text-current">{value}</div>
    </div>
  )
}

function summarizeTurnMetrics(turns: UserTurn[]) {
  const tokenStats = summarizeTurnsTokenUsage(turns)
  let activeDurationMs = 0

  for (const turn of turns) {
    activeDurationMs += Math.max(
      1,
      turn.last_context_activity_at.getTime() - turn.created_at.getTime(),
    )
  }

  return {
    turns: turns.length,
    tokenUsage: tokenStats.usage,
    trackedTurns: tokenStats.trackedTurns,
    activeDurationMs,
  }
}

function countUniqueSessions(turns: UserTurn[]) {
  return new Set(turns.map((turn) => turn.session_id)).size
}

function formatDurationCompact(durationMs: number) {
  const totalMinutes = Math.max(1, Math.round(durationMs / 60000))
  if (totalMinutes < 60) {
    return `${totalMinutes}m`
  }

  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours < 24) {
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
  }

  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return remainingHours === 0 ? `${days}d` : `${days}d ${remainingHours}h`
}

function projectTurnLayoutClassName(layout: ProjectTurnLayout) {
  if (layout === 'cards') {
    return 'grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3'
  }
  if (layout === 'waterfall') {
    return 'columns-1 gap-4 lg:columns-2 2xl:columns-3'
  }
  return 'space-y-2'
}

function turnRowStatusChips(turn: UserTurn) {
  const chips: Array<{ label: string; className: string }> = []

  if (turn.link_state === 'committed') {
    chips.push({ label: 'VERIFIED', className: 'border-success/30 bg-success/10 text-success' })
  } else if (turn.link_state === 'candidate') {
    chips.push({
      label: turn.project_confidence ? `${Math.round(turn.project_confidence * 100)}%` : 'CANDIDATE',
      className: 'border-candidate/30 bg-candidate/10 text-candidate',
    })
  } else {
    chips.push({ label: 'UNLINKED', className: 'border-border bg-paper text-muted' })
  }

  if (turn.is_flagged) {
    chips.push({ label: 'FLAGGED', className: 'border-warning/30 bg-warning/10 text-warning' })
  }

  if (turn.sync_axis === 'superseded') {
    chips.push({ label: 'STALE', className: 'border-border bg-surface-hover text-muted' })
  }

  return chips
}

function ProjectStateBadge({ project }: { project: ProjectIdentity }) {
  if (project.linkage_state === 'candidate') {
    return (
      <span className="border border-candidate/30 bg-candidate/10 px-1.5 py-0.5 text-candidate">
        CANDIDATE {(project.confidence * 100).toFixed(0)}%
      </span>
    )
  }

  return <span className="border border-success/30 bg-success/10 px-1.5 py-0.5 text-success">COMMITTED</span>
}

function formatLinkReason(reason: ProjectIdentity['link_reason']) {
  switch (reason) {
    case 'repo_fingerprint_match':
      return 'Repo fingerprint'
    case 'repo_remote_match':
      return 'Repo remote'
    case 'workspace_path_continuity':
      return 'Workspace path'
    case 'source_native_project':
      return 'Source-native project'
    case 'manual_override':
      return 'Manual override'
    case 'weak_path_hint':
      return 'Weak path hint'
    case 'metadata_hint':
      return 'Metadata hint'
  }
}
