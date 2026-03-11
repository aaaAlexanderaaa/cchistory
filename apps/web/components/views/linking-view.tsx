'use client'

import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { useSWRConfig } from 'swr'
import {
  Link2,
  Check,
  X,
  RefreshCw,
  FolderOpen,
  AlertCircle,
  Eye,
  GitBranch,
  FolderGit2,
  ArrowUpDown,
} from 'lucide-react'
import { cn, formatAbsoluteDateTime, formatRelativeTime, truncateText } from '@/lib/utils'
import { TurnDetailPanel } from '@/components/turn-detail-panel'
import { SessionBadge } from '@/components/session-badge'
import { ResponsiveSidePanel } from '@/components/responsive-side-panel'
import type { ProjectIdentity, Session, UserTurn } from '@/lib/types'
import {
  createProjectStub,
  type LinkingObservation,
  upsertLinkingOverride,
  useLinkingReviewQuery,
  useSessionsQuery,
  useSessionQuery,
  useTurnContextQuery,
  useTurnQuery,
} from '@/lib/api'

const EMPTY_TURNS: UserTurn[] = []
const EMPTY_PROJECTS: ProjectIdentity[] = []
const EMPTY_OBSERVATIONS: LinkingObservation[] = []
type LinkingSort = 'newest' | 'oldest' | 'confidence' | 'replies'

export function LinkingView() {
  const { data: review } = useLinkingReviewQuery()
  const { data: sessions = [] } = useSessionsQuery()
  const { mutate } = useSWRConfig()
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<LinkingSort>('newest')

  const unlinkedTurns = review?.unlinked_turns ?? EMPTY_TURNS
  const candidateTurns = review?.candidate_turns ?? EMPTY_TURNS
  const candidateProjects = review?.candidate_projects ?? EMPTY_PROJECTS
  const committedProjects = review?.committed_projects ?? EMPTY_PROJECTS
  const observations = review?.project_observations ?? EMPTY_OBSERVATIONS

  const projectRegistry = useMemo(() => {
    const registry = new Map<string, ProjectIdentity>()
    for (const project of [...committedProjects, ...candidateProjects]) {
      registry.set(project.id, project)
    }
    for (const turn of [...unlinkedTurns, ...candidateTurns]) {
      if (turn.project_id && !registry.has(turn.project_id)) {
        registry.set(turn.project_id, createProjectStub(turn.project_id))
      }
    }
    return registry
  }, [candidateProjects, candidateTurns, committedProjects, unlinkedTurns])

  const observationsBySession = useMemo(() => {
    const registry = new Map<string, LinkingObservation[]>()
    for (const observation of observations) {
      const current = registry.get(observation.session_ref)
      if (current) {
        current.push(observation)
        continue
      }
      registry.set(observation.session_ref, [observation])
    }
    return registry
  }, [observations])
  const sessionRegistry = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  )
  const sortTurns = useMemo(
    () => (items: UserTurn[]) => {
      return [...items].sort((left, right) => {
        if (sortBy === 'oldest') {
          return left.created_at.getTime() - right.created_at.getTime()
        }
        if (sortBy === 'confidence') {
          const confidenceDelta = (right.project_confidence ?? 0) - (left.project_confidence ?? 0)
          if (confidenceDelta !== 0) {
            return confidenceDelta
          }
          return right.created_at.getTime() - left.created_at.getTime()
        }
        if (sortBy === 'replies') {
          const replyDelta = right.context_summary.assistant_reply_count - left.context_summary.assistant_reply_count
          if (replyDelta !== 0) {
            return replyDelta
          }
          return right.created_at.getTime() - left.created_at.getTime()
        }
        return right.created_at.getTime() - left.created_at.getTime()
      })
    },
    [sortBy],
  )
  const sortedUnlinkedTurns = useMemo(() => sortTurns(unlinkedTurns), [sortTurns, unlinkedTurns])
  const sortedCandidateTurns = useMemo(() => sortTurns(candidateTurns), [candidateTurns, sortTurns])

  const selectedTurnSummary = useMemo(
    () =>
      [...sortedUnlinkedTurns, ...sortedCandidateTurns].find((turn) => turn.id === selectedTurnId) ??
      null,
    [selectedTurnId, sortedCandidateTurns, sortedUnlinkedTurns],
  )
  const { data: selectedTurnDetail } = useTurnQuery(selectedTurnSummary?.id ?? undefined)
  const selectedTurn = selectedTurnDetail ?? selectedTurnSummary
  const { data: selectedContext } = useTurnContextQuery(selectedTurn?.id)
  const { data: selectedSession } = useSessionQuery(selectedTurn?.session_id)
  const selectedProject = selectedTurn?.project_id
    ? projectRegistry.get(selectedTurn.project_id) ?? createProjectStub(selectedTurn.project_id)
    : undefined

  const refreshLinkingViews = async () => {
    await Promise.all([
      mutate('/api/admin/linking'),
      mutate('/api/admin/linking/overrides'),
      mutate('/api/projects?state=all'),
      mutate('/api/turns'),
    ])
  }

  const handleLink = async (turnId: string, projectId: string) => {
    const project = projectRegistry.get(projectId)
    await upsertLinkingOverride({
      target_kind: 'turn',
      target_ref: turnId,
      project_id: projectId,
      display_name: project?.name,
    })
    await refreshLinkingViews()
    setSelectedTurnId(turnId)
  }

  const handleDismiss = (turnId: string) => {
    setSelectedTurnId((current) => (current === turnId ? null : current))
  }

  const handleCreateProject = async (turnId: string) => {
    const turn = [...unlinkedTurns, ...candidateTurns].find((candidateTurn) => candidateTurn.id === turnId)
    const displayName = turn?.canonical_text.slice(0, 42) || 'Manual Project'
    await upsertLinkingOverride({
      target_kind: 'turn',
      target_ref: turnId,
      display_name: displayName,
    })
    await refreshLinkingViews()
    setSelectedTurnId(turnId)
  }

  const handleAutoLinkCandidates = async () => {
    const eligibleTurns = candidateTurns.filter((turn) => turn.project_id)
    for (const turn of eligibleTurns) {
      await upsertLinkingOverride({
        target_kind: 'turn',
        target_ref: turn.id,
        project_id: turn.project_id,
        display_name: turn.project_id ? projectRegistry.get(turn.project_id)?.name : undefined,
      })
    }
    await refreshLinkingViews()
  }

  return (
    <div className="flex h-full min-h-0">
      <div className={cn('flex-1 flex flex-col lg:border-r lg:border-border', selectedTurn && 'lg:border-r lg:border-border')}>
        <header className="border-b border-border bg-card px-4 py-3 sm:px-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <Link2 className="w-5 h-5 text-ink" />
              <h1 className="text-lg font-bold font-display text-ink">Turn Linking</h1>
              <span className="px-2 py-0.5 text-[10px] stamp-text bg-warning/20 text-warning">
                {unlinkedTurns.length + candidateTurns.length} PENDING
              </span>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2 text-sm text-muted">
                <ArrowUpDown className="h-4 w-4" />
                <select
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value as LinkingSort)}
                  className="border border-border bg-card px-2 py-1.5 text-sm text-text focus:border-ink focus:outline-none"
                >
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="confidence">Confidence</option>
                  <option value="replies">Replies</option>
                </select>
              </div>
              <button
                type="button"
                onClick={() => void refreshLinkingViews()}
                className="px-3 py-1.5 text-sm border border-border hover:border-ink transition-colors flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
              <button
                type="button"
                onClick={() => void handleAutoLinkCandidates()}
                className="px-3 py-1.5 text-sm bg-ink text-card hover:bg-ink/80 transition-colors"
              >
                Auto-link Candidates
              </button>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {unlinkedTurns.length > 0 && (
            <section className="p-4">
              <h2 className="text-[10px] stamp-text text-muted mb-3 flex items-center gap-2">
                <AlertCircle className="w-3 h-3" />
                UNLINKED TURNS ({unlinkedTurns.length})
              </h2>

              <div className="space-y-3">
                {sortedUnlinkedTurns.map((turn) => (
                    <ReviewCard
                      key={turn.id}
                      turn={turn}
                      session={sessionRegistry.get(turn.session_id)}
                      evidence={observationsBySession.get(turn.session_id) ?? []}
                      isSelected={selectedTurn?.id === turn.id}
                      onSelect={() => setSelectedTurnId(turn.id)}
                    footer={
                      <div className="flex items-center gap-2 mt-3">
                        <button
                          type="button"
                          className="flex-1 py-1.5 text-xs border border-border hover:border-ink transition-colors flex items-center justify-center gap-1"
                          onClick={() => handleCreateProject(turn.id)}
                        >
                          <FolderOpen className="w-3 h-3" />
                          New Project
                        </button>
                        <button
                          type="button"
                          className="px-3 py-1.5 text-xs text-muted hover:text-danger transition-colors"
                          onClick={() => handleDismiss(turn.id)}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    }
                  />
                ))}
              </div>
            </section>
          )}

          {candidateTurns.length > 0 && (
            <section className="p-4 border-t border-border">
              <h2 className="text-[10px] stamp-text text-warning mb-3">
                CANDIDATE LINKS ({candidateTurns.length})
              </h2>

              <div className="space-y-3">
                {sortedCandidateTurns.map((turn) => {
                  const project = turn.project_id
                    ? projectRegistry.get(turn.project_id) ?? createProjectStub(turn.project_id)
                    : undefined
                  return (
                    <ReviewCard
                      key={turn.id}
                      turn={turn}
                      session={sessionRegistry.get(turn.session_id)}
                      project={project}
                      evidence={observationsBySession.get(turn.session_id) ?? []}
                      isSelected={selectedTurn?.id === turn.id}
                      onSelect={() => setSelectedTurnId(turn.id)}
                      footer={
                        <div className="flex items-center justify-between gap-3 mt-3">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="p-1.5 bg-success text-white hover:bg-success/80"
                              onClick={() => project && handleLink(turn.id, project.id)}
                            >
                              <Check className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              className="p-1.5 border border-border text-muted hover:text-danger hover:border-danger"
                              onClick={() => handleDismiss(turn.id)}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      }
                    />
                  )
                })}
              </div>
            </section>
          )}

          {unlinkedTurns.length === 0 && candidateTurns.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center">
              <Check className="w-12 h-12 text-success mb-4" />
              <div className="text-lg font-medium text-ink mb-2">All Caught Up</div>
              <div className="text-sm text-muted">No turns pending review. New imports will appear here.</div>
            </div>
          )}
        </div>
      </div>

      {selectedTurn && (
        <ResponsiveSidePanel onDismiss={() => setSelectedTurnId(null)} className="lg:w-[480px] lg:flex-shrink-0">
          <TurnDetailPanel
            turn={selectedTurn}
            context={selectedContext}
            session={selectedSession}
            project={selectedProject}
            onClose={() => setSelectedTurnId(null)}
            className="h-full lg:w-[480px] lg:flex-shrink-0"
          />
        </ResponsiveSidePanel>
      )}
    </div>
  )
}

function ReviewCard({
  turn,
  session,
  project,
  evidence,
  isSelected,
  onSelect,
  footer,
}: {
  turn: UserTurn
  session?: Session
  project?: ProjectIdentity
  evidence: LinkingObservation[]
  isSelected: boolean
  onSelect: () => void
  footer?: ReactNode
}) {
  return (
    <div className={cn('border border-border bg-card transition-all', isSelected && 'ring-2 ring-accent')}>
      <div className="p-4 cursor-pointer hover:bg-surface-hover" onClick={onSelect}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-sm text-ink mb-1">{truncateText(turn.canonical_text, 120)}</div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
              <span className="mono-text">{turn.source_id}</span>
              <span className="mono-text">{formatAbsoluteDateTime(turn.created_at)}</span>
              <span>{formatRelativeTime(turn.created_at)}</span>
              <span>{turn.context_summary.assistant_reply_count} replies</span>
            </div>
          </div>
          <button
            type="button"
            className="p-1.5 text-muted hover:text-ink"
            onClick={(event) => {
              event.stopPropagation()
              onSelect()
            }}
          >
            <Eye className="w-4 h-4" />
          </button>
        </div>

        {session && (
          <div className="mt-3">
            <SessionBadge session={session} compact />
          </div>
        )}

        {project && (
          <div className="mt-3 flex items-center gap-2 text-xs">
            <FolderOpen className="w-3.5 h-3.5 text-candidate" />
            <span className="text-candidate">{project.name}</span>
            {turn.project_confidence && (
              <span className="mono-text text-muted">{Math.round(turn.project_confidence * 100)}%</span>
            )}
          </div>
        )}

        <EvidenceStrip evidence={evidence} />
      </div>

      <div className="border-t border-border bg-paper p-3">{footer}</div>
    </div>
  )
}

function EvidenceStrip({ evidence }: { evidence: LinkingObservation[] }) {
  if (evidence.length === 0) {
    return <div className="mt-3 text-xs text-muted">No persisted project evidence for this session yet.</div>
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="text-[10px] stamp-text text-muted">SESSION EVIDENCE</div>
      <div className="flex flex-wrap gap-2">
        {evidence.map((observation) => (
          <span key={observation.id} className="inline-flex items-center gap-1.5 border border-border bg-card px-2 py-1 text-xs text-muted">
            {observation.repo_fingerprint ? <GitBranch className="w-3 h-3" /> : <FolderGit2 className="w-3 h-3" />}
            {observation.workspace_subpath
              ? observation.workspace_subpath
              : observation.workspace_path_normalized || observation.repo_remote || 'workspace'}
          </span>
        ))}
      </div>
    </div>
  )
}
