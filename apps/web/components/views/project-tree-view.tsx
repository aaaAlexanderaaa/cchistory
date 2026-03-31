'use client'

import { useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Clock3,
  FolderOpen,
  FolderTree,
  Layers3,
  PanelsTopLeft,
} from 'lucide-react'
import { SummaryPill } from '@/components/summary-pill'
import { SessionBadge, formatSourcePlatform } from '@/components/session-badge'
import { cn, formatAbsoluteDateTime, formatRelativeTime } from '@/lib/utils'
import type { ProjectIdentity, Session, UserTurn } from '@/lib/types'

interface ProjectTreeViewProps {
  projects: ProjectIdentity[]
  turnsByProjectId: Map<string, UserTurn[]>
  sessionRegistry: Map<string, Session>
  selectedTurnId?: string | null
  onSelectTurn: (turnId: string | null) => void
  onOpenProject: (projectId: string) => void
}

interface ProjectTreeSessionNode {
  sessionId: string
  session?: Session
  turns: UserTurn[]
  updatedAt: Date
}

interface ProjectTreeProjectNode {
  project: ProjectIdentity
  turns: UserTurn[]
  sessions: ProjectTreeSessionNode[]
}

export function ProjectTreeView({
  projects,
  turnsByProjectId,
  sessionRegistry,
  selectedTurnId,
  onSelectTurn,
  onOpenProject,
}: ProjectTreeViewProps) {
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(new Set())
  const [expandedSessionIds, setExpandedSessionIds] = useState<Set<string>>(new Set())

  const projectNodes = useMemo<ProjectTreeProjectNode[]>(() => {
    return projects.map((project) => {
      const projectTurns = [...(turnsByProjectId.get(project.id) ?? [])].sort(
        (left, right) => right.last_context_activity_at.getTime() - left.last_context_activity_at.getTime(),
      )
      const turnsBySession = new Map<string, UserTurn[]>()

      for (const turn of projectTurns) {
        const current = turnsBySession.get(turn.session_id)
        if (current) {
          current.push(turn)
        } else {
          turnsBySession.set(turn.session_id, [turn])
        }
      }

      const sessions = [...turnsBySession.entries()]
        .map(([sessionId, sessionTurns]) => {
          const orderedTurns = [...sessionTurns].sort(
            (left, right) => left.created_at.getTime() - right.created_at.getTime(),
          )
          const session = sessionRegistry.get(sessionId)
          const updatedAt = session?.updated_at ?? orderedTurns[orderedTurns.length - 1]?.last_context_activity_at ?? project.last_activity
          return {
            sessionId,
            session,
            turns: orderedTurns,
            updatedAt,
          }
        })
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())

      return {
        project,
        turns: projectTurns,
        sessions,
      }
    })
  }, [projects, sessionRegistry, turnsByProjectId])

  const selectedLocation = (() => {
    if (!selectedTurnId) {
      return null
    }

    for (const projectNode of projectNodes) {
      for (const sessionNode of projectNode.sessions) {
        if (sessionNode.turns.some((turn) => turn.id === selectedTurnId)) {
          return {
            projectId: projectNode.project.id,
            sessionId: sessionNode.sessionId,
          }
        }
      }
    }
    return null
  })()

  const effectiveExpandedProjectIds = useMemo(() => {
    const next = new Set(expandedProjectIds)
    if (selectedLocation) {
      next.add(selectedLocation.projectId)
    }
    return next
  }, [expandedProjectIds, selectedLocation])

  const effectiveExpandedSessionIds = useMemo(() => {
    const next = new Set(expandedSessionIds)
    if (selectedLocation) {
      next.add(selectedLocation.sessionId)
    }
    return next
  }, [expandedSessionIds, selectedLocation])

  const summary = useMemo(() => {
    const sessionCount = new Set(projectNodes.flatMap((projectNode) => projectNode.sessions.map((sessionNode) => sessionNode.sessionId))).size
    const turnCount = projectNodes.reduce((sum, projectNode) => sum + projectNode.turns.length, 0)
    const candidateProjects = projectNodes.filter((projectNode) => projectNode.project.linkage_state === 'candidate').length
    return {
      projects: projectNodes.length,
      sessions: sessionCount,
      turns: turnCount,
      candidateProjects,
    }
  }, [projectNodes])

  const toggleProject = (projectId: string) => {
    setExpandedProjectIds((current) => {
      const next = new Set(current)
      if (next.has(projectId)) {
        next.delete(projectId)
      } else {
        next.add(projectId)
      }
      return next
    })
  }

  const toggleSession = (sessionId: string) => {
    setExpandedSessionIds((current) => {
      const next = new Set(current)
      if (next.has(sessionId)) {
        next.delete(sessionId)
      } else {
        next.add(sessionId)
      }
      return next
    })
  }

  if (projectNodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center border border-dashed border-border bg-card p-6 text-sm text-muted">
        No linked projects are available for tree navigation yet.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="border border-border bg-card px-4 py-4 shadow-hard sm:px-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <FolderTree className="h-4 w-4 text-ink" />
          <div className="text-[10px] stamp-text text-muted">PROJECT HIERARCHY</div>
        </div>
        <div className="mb-3 text-sm text-muted">
          Expand projects into sessions and turns, or jump into the existing project detail flow.
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SummaryPill label="Projects" value={String(summary.projects)} />
          <SummaryPill label="Sessions" value={String(summary.sessions)} />
          <SummaryPill label="Turns" value={String(summary.turns)} />
          <SummaryPill
            label="Candidate Projects"
            value={String(summary.candidateProjects)}
            tone={summary.candidateProjects > 0 ? 'candidate' : 'normal'}
          />
        </div>
      </div>

      <div className="space-y-3">
        {projectNodes.map((projectNode) => {
          const expanded = effectiveExpandedProjectIds.has(projectNode.project.id)
          return (
            <section key={projectNode.project.id} className="border border-border bg-card shadow-hard">
              <div className="flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => toggleProject(projectNode.project.id)}
                      aria-expanded={expanded}
                      aria-controls={`project-tree-${projectNode.project.id}`}
                      className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center border border-border bg-paper text-muted transition-colors hover:border-ink hover:text-ink"
                    >
                      {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] stamp-text">
                        <ProjectStateChip project={projectNode.project} />
                        <span className="border border-border bg-paper px-2 py-1 text-muted">
                          {projectNode.sessions.length} sessions
                        </span>
                        <span className="border border-border bg-paper px-2 py-1 text-muted">
                          {projectNode.turns.length} turns
                        </span>
                        <span className="border border-border bg-paper px-2 py-1 text-muted">
                          Active {formatRelativeTime(projectNode.project.last_activity)}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => toggleProject(projectNode.project.id)}
                        className="text-left"
                        aria-expanded={expanded}
                        aria-controls={`project-tree-${projectNode.project.id}`}
                      >
                        <h3 className="font-display text-lg font-semibold text-ink transition-colors hover:text-accent">
                          {projectNode.project.name}
                        </h3>
                      </button>

                      {projectNode.project.description && (
                        <p className="mt-1 text-sm text-muted line-clamp-2">{projectNode.project.description}</p>
                      )}

                      {projectNode.project.primary_workspace_path && (
                        <div className="mt-2 truncate mono-text text-[10px] text-muted">
                          {projectNode.project.primary_workspace_path}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onOpenProject(projectNode.project.id)}
                  className="inline-flex items-center justify-center gap-2 border border-border px-3 py-2 text-sm text-ink transition-colors hover:border-ink hover:bg-paper"
                >
                  <FolderOpen className="h-4 w-4" />
                  Open Project
                </button>
              </div>

              {expanded && (
                <div id={`project-tree-${projectNode.project.id}`} className="border-t border-border bg-paper px-4 py-4">
                  {projectNode.sessions.length === 0 ? (
                    <div className="text-sm text-muted">No sessions are linked to this project yet.</div>
                  ) : (
                    <div className="ml-4 space-y-3 border-l border-border pl-4 sm:ml-6 sm:pl-5">
                      {projectNode.sessions.map((sessionNode) => {
                        const sessionExpanded = effectiveExpandedSessionIds.has(sessionNode.sessionId)
                        return (
                          <section key={sessionNode.sessionId} className="border border-border bg-card">
                            <div className="flex items-start gap-3 px-3 py-3">
                              <button
                                type="button"
                                onClick={() => toggleSession(sessionNode.sessionId)}
                                aria-expanded={sessionExpanded}
                                aria-controls={`project-tree-session-${sessionNode.sessionId}`}
                                className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center border border-border bg-paper text-muted transition-colors hover:border-ink hover:text-ink"
                              >
                                {sessionExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                              </button>

                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  {sessionNode.session ? (
                                    <SessionBadge
                                      session={sessionNode.session}
                                      compact
                                      showPlatform
                                      showTurnCount={false}
                                      className="max-w-full bg-paper"
                                    />
                                  ) : (
                                    <span className="inline-flex min-w-0 items-center gap-1.5 border border-border bg-paper px-2 py-1 text-[10px] text-muted">
                                      <PanelsTopLeft className="h-3 w-3 flex-shrink-0" />
                                      <span className="truncate">Session {sessionNode.sessionId.slice(0, 8)}</span>
                                    </span>
                                  )}
                                  <span className="inline-flex items-center gap-1 border border-border bg-paper px-2 py-1 text-[10px] stamp-text text-muted">
                                    <Layers3 className="h-3 w-3" />
                                    {sessionNode.turns.length} turns
                                  </span>
                                  <span className="inline-flex items-center gap-1 border border-border bg-paper px-2 py-1 text-[10px] stamp-text text-muted">
                                    <Clock3 className="h-3 w-3" />
                                    {formatRelativeTime(sessionNode.updatedAt)}
                                  </span>
                                </div>

                                {(sessionNode.session?.working_directory || sessionNode.session?.source_platform) && (
                                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] stamp-text text-muted">
                                    {sessionNode.session?.source_platform && (
                                      <span className="border border-border bg-paper px-2 py-1 mono-text">
                                        {formatSourcePlatform(sessionNode.session.source_platform)}
                                      </span>
                                    )}
                                    {sessionNode.session?.working_directory && (
                                      <span className="truncate mono-text text-muted">
                                        {sessionNode.session.working_directory}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>

                            {sessionExpanded && (
                              <div
                                id={`project-tree-session-${sessionNode.sessionId}`}
                                className="space-y-2 border-t border-border px-3 py-3"
                              >
                                {sessionNode.turns.map((turn) => (
                                  <button
                                    key={turn.id}
                                    type="button"
                                    onClick={() => onSelectTurn(turn.id)}
                                    className={cn(
                                      'w-full border px-3 py-3 text-left transition-colors hover:border-ink hover:bg-surface-hover',
                                      selectedTurnId === turn.id ? 'border-ink bg-paper shadow-hard' : 'border-border bg-card',
                                    )}
                                  >
                                    <div className="flex flex-wrap items-center gap-2 text-[10px] stamp-text text-muted">
                                      <TurnStateChip turn={turn} />
                                      <span>{formatRelativeTime(turn.created_at)}</span>
                                      <span title={formatAbsoluteDateTime(turn.created_at)}>{formatAbsoluteDateTime(turn.created_at)}</span>
                                      <span>{turn.context_summary.assistant_reply_count} replies</span>
                                      {turn.context_summary.tool_call_count > 0 && (
                                        <span>{turn.context_summary.tool_call_count} tools</span>
                                      )}
                                    </div>
                                    <div className="mt-2 text-sm leading-6 text-ink line-clamp-2">
                                      {turn.canonical_text || 'No canonical turn text available.'}
                                    </div>
                                  </button>
                                ))}
                              </div>
                            )}
                          </section>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

function ProjectStateChip({ project }: { project: ProjectIdentity }) {
  if (project.linkage_state === 'candidate') {
    return (
      <span className="border border-candidate/30 bg-candidate/10 px-2 py-1 text-candidate">
        CANDIDATE {Math.round(project.confidence * 100)}%
      </span>
    )
  }

  return <span className="border border-success/30 bg-success/10 px-2 py-1 text-success">COMMITTED</span>
}

function TurnStateChip({ turn }: { turn: UserTurn }) {
  if (turn.link_state === 'committed') {
    return <span className="border border-success/30 bg-success/10 px-2 py-1 text-success">VERIFIED</span>
  }

  if (turn.link_state === 'candidate') {
    return (
      <span className="border border-candidate/30 bg-candidate/10 px-2 py-1 text-candidate">
        {turn.project_confidence ? `${Math.round(turn.project_confidence * 100)}%` : 'CANDIDATE'}
      </span>
    )
  }

  return <span className="border border-border bg-paper px-2 py-1 text-muted">UNLINKED</span>
}
