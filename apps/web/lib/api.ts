'use client'

import useSWR from 'swr'
import {
  createCCHistoryApiClient,
  type DriftReportDto,
  getDefaultApiBaseUrl,
  type LinkingObservationDto,
  type LinkingReviewResponse,
  type MaskTemplateDto,
  type PipelineLineageDto,
  type ProjectLineageEventDto,
  type ProjectLinkRevisionDto,
  type ProjectManualOverrideDto,
  type ProjectSummaryDto,
  type SessionProjectionDto,
  type SourceStatusDto,
  type TurnContextProjectionDto,
  type TurnSearchResultDto,
  type UserTurnProjectionDto,
  type UpsertLinkingOverrideRequest,
} from '@cchistory/api-client'
import type {
  DriftReport,
  LinkState,
  MaskTemplate,
  ProjectIdentity,
  ProjectLineageEvent,
  ProjectManualOverride,
  ProjectRevision,
  SearchResult,
  Session,
  SourceStatus,
  TurnContext,
  TurnLineage,
  UserTurn,
} from '@/lib/types'
const DEFAULT_API_BASE_URL = '/api/cchistory'

export function getApiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_CCHISTORY_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, '')
}

function getApiClient() {
  return createCCHistoryApiClient({ baseUrl: getApiBaseUrl() })
}

export function useTurnsQuery() {
  return useSWR<UserTurn[]>('/api/turns', async (path: string) => {
    void path
    return (await getApiClient().getTurns()).map(mapUserTurn)
  }, { revalidateOnFocus: false })
}

export function useTurnQuery(turnId?: string) {
  return useSWR<UserTurn>(
    turnId ? `/api/turns/${encodeURIComponent(turnId)}` : null,
    async () => mapUserTurn(await getApiClient().getTurn(turnId!)),
    { revalidateOnFocus: false },
  )
}

export function useTurnContextQuery(turnId?: string) {
  return useSWR<TurnContext>(
    turnId ? `/api/turns/${encodeURIComponent(turnId)}/context` : null,
    async () => mapTurnContext(await getApiClient().getTurnContext(turnId!)),
    { revalidateOnFocus: false },
  )
}

export function useSessionQuery(sessionId?: string) {
  return useSWR<Session>(
    sessionId ? `/api/sessions/${encodeURIComponent(sessionId)}` : null,
    async () => mapSession(await getApiClient().getSession(sessionId!)),
    { revalidateOnFocus: false },
  )
}

export function useSessionsQuery() {
  return useSWR<Session[]>('/api/sessions', async () => (await getApiClient().getSessions()).map(mapSession), {
    revalidateOnFocus: false,
  })
}

export function useProjectsQuery(state: 'committed' | 'candidate' | 'all' = 'all') {
  return useSWR<ProjectIdentity[]>(`/api/projects?state=${state}`, async () => {
    return (await getApiClient().getProjects(state)).map(mapProject)
  }, { revalidateOnFocus: false })
}

export function useProjectTurnsQuery(projectId?: string, state: 'committed' | 'candidate' | 'all' = 'all') {
  return useSWR<UserTurn[]>(
    projectId ? `/api/projects/${encodeURIComponent(projectId)}/turns?state=${state}` : null,
    async () => (await getApiClient().getProjectTurns(projectId!, state)).map(mapUserTurn),
    { revalidateOnFocus: false },
  )
}

export function useProjectRevisionsQuery(projectId?: string) {
  return useSWR<{ revisions: ProjectRevision[]; lineage_events: ProjectLineageEvent[] }>(
    projectId ? `/api/projects/${encodeURIComponent(projectId)}/revisions` : null,
    async () => {
      const response = await getApiClient().getProjectRevisions(projectId!)
      return {
        revisions: response.revisions.map(mapProjectRevision),
        lineage_events: response.lineage_events.map(mapProjectLineageEvent),
      }
    },
    { revalidateOnFocus: false },
  )
}

export function useSourcesQuery() {
  return useSWR<SourceStatus[]>('/api/sources', async () => (await getApiClient().getSources()).map(mapSourceStatus), {
    revalidateOnFocus: false,
  })
}

export function useMasksQuery() {
  return useSWR<MaskTemplate[]>(
    '/api/admin/masks',
    async () => (await getApiClient().getMasks()).map(mapMaskTemplate),
    { revalidateOnFocus: false },
  )
}

export function useDriftQuery() {
  return useSWR<DriftReport>('/api/admin/drift', async () => mapDriftReport(await getApiClient().getDriftReport()), {
    revalidateOnFocus: false,
  })
}

export function useTurnSearchQuery(params: {
  query?: string
  project_id?: string
  source_ids?: string[]
  link_states?: LinkState[]
  value_axes?: Array<'active' | 'covered' | 'archived' | 'suppressed'>
  limit?: number
}) {
  const shouldFetch = Boolean(params.query?.trim()) || Boolean(params.project_id) || Boolean(params.link_states?.length)
  const key = shouldFetch ? JSON.stringify(['turn-search', params]) : null
  return useSWR<SearchResult[]>(
    key,
    async () => {
      const response = await getApiClient().searchTurns({
        q: params.query,
        project_id: params.project_id,
        source_ids: params.source_ids,
        link_states: params.link_states,
        value_axes: params.value_axes,
        limit: params.limit,
      })
      return response.map(mapSearchResult)
    },
    { revalidateOnFocus: false },
  )
}

export function useTurnLineageQuery(turnId?: string) {
  return useSWR<TurnLineage>(
    turnId ? `/api/admin/pipeline/lineage/${encodeURIComponent(turnId)}` : null,
    async () => mapTurnLineage(await getApiClient().getTurnLineage(turnId!)),
    { revalidateOnFocus: false },
  )
}

export interface LinkingObservation {
  id: string
  source_id: string
  session_ref: string
  observed_at: Date
  confidence: number
  workspace_path?: string
  workspace_path_normalized?: string
  repo_root?: string
  repo_remote?: string
  repo_fingerprint?: string
  source_native_project_ref?: string
  host_id: string
  source_platform: Session['source_platform']
  workspace_subpath?: string
  project_id?: string
  linkage_state?: Exclude<LinkState, 'unlinked'>
  link_reason?: LinkingObservationDto['link_reason']
}

export interface LinkingReviewData {
  committed_projects: ProjectIdentity[]
  candidate_projects: ProjectIdentity[]
  unlinked_turns: UserTurn[]
  candidate_turns: UserTurn[]
  project_observations: LinkingObservation[]
}

export function useLinkingReviewQuery() {
  return useSWR<LinkingReviewData>(
    '/api/admin/linking',
    async (path: string) => {
      void path
      return mapLinkingReview(await getApiClient().getLinkingReview())
    },
    { revalidateOnFocus: false },
  )
}

export function useLinkingOverridesQuery() {
  return useSWR<ProjectManualOverride[]>(
    '/api/admin/linking/overrides',
    async () => (await getApiClient().getLinkingOverrides()).map(mapProjectManualOverride),
    { revalidateOnFocus: false },
  )
}

export async function upsertLinkingOverride(payload: UpsertLinkingOverrideRequest) {
  const response = await getApiClient().upsertLinkingOverride(payload)
  return {
    override: mapProjectManualOverride(response.override),
    project: response.project ? mapProject(response.project) : undefined,
  }
}

export function createProjectStub(projectId: string): ProjectIdentity {
  const suffix = projectId.replace(/^project-/, '').slice(0, 8) || projectId.slice(-8)
  return {
    id: projectId,
    revision_id: `${projectId}:stub`,
    name: `Unresolved ${suffix}`,
    description: 'Project metadata is missing for this linked turn.',
    color: projectColor(projectId),
    linkage_state: 'candidate',
    confidence: 0,
    link_reason: 'metadata_hint',
    manual_override_status: 'none',
    committed_turn_count: 0,
    candidate_turn_count: 0,
    session_count: 0,
    source_platforms: [],
    host_ids: [],
    last_activity: new Date(0),
    created_at: new Date(0),
  }
}

function mapUserTurn(turn: UserTurnProjectionDto): UserTurn {
  return {
    id: turn.id,
    revision_id: turn.revision_id,
    user_messages: turn.user_messages.map((message) => ({
      id: message.id,
      raw_text: message.raw_text,
      sequence: message.sequence,
      is_injected: message.is_injected,
      created_at: new Date(message.created_at),
    })),
    canonical_text: turn.canonical_text,
    display_segments: turn.display_segments,
    created_at: new Date(turn.submission_started_at || turn.created_at),
    last_context_activity_at: new Date(turn.last_context_activity_at),
    session_id: turn.session_id,
    source_id: turn.source_id,
    project_id: turn.project_id,
    link_state: turn.link_state,
    project_confidence: turn.project_confidence,
    candidate_project_ids: turn.candidate_project_ids,
    sync_axis: turn.sync_axis,
    value_axis: turn.value_axis,
    retention_axis: turn.retention_axis,
    context_ref: turn.context_ref,
    context_summary: turn.context_summary,
  }
}

function mapTurnContext(context: TurnContextProjectionDto): TurnContext {
  return {
    turn_id: context.turn_id,
    system_messages: context.system_messages.map((message) => ({
      ...message,
      created_at: new Date(message.created_at),
    })),
    assistant_replies: context.assistant_replies.map((reply) => ({
      ...reply,
      created_at: new Date(reply.created_at),
    })),
    tool_calls: context.tool_calls.map((toolCall) => ({
      ...toolCall,
      created_at: new Date(toolCall.created_at),
    })),
    raw_event_refs: context.raw_event_refs,
  }
}

function mapSession(session: SessionProjectionDto): Session {
  return {
    ...session,
    created_at: new Date(session.created_at),
    updated_at: new Date(session.updated_at),
  }
}

function mapProject(project: ProjectSummaryDto): ProjectIdentity {
  return {
    id: project.project_id,
    revision_id: project.project_revision_id,
    name: project.display_name,
    color: projectColor(project.project_id),
    slug: project.slug,
    linkage_state: project.linkage_state,
    confidence: project.confidence,
    link_reason: project.link_reason,
    manual_override_status: project.manual_override_status,
    primary_workspace_path: project.primary_workspace_path,
    repo_root: project.repo_root,
    primary_repo_remote: project.repo_remote,
    repo_fingerprint: project.repo_fingerprint,
    committed_turn_count: project.committed_turn_count,
    candidate_turn_count: project.candidate_turn_count,
    session_count: project.session_count,
    source_platforms: project.source_platforms,
    host_ids: project.host_ids,
    last_activity: new Date(project.project_last_activity_at ?? project.updated_at),
    created_at: new Date(project.created_at),
  }
}

function mapLinkingReview(review: LinkingReviewResponse): LinkingReviewData {
  return {
    committed_projects: review.committed_projects.map(mapProject),
    candidate_projects: review.candidate_projects.map(mapProject),
    unlinked_turns: review.unlinked_turns.map(mapUserTurn),
    candidate_turns: review.candidate_turns.map(mapUserTurn),
    project_observations: review.project_observations.map(mapLinkingObservation),
  }
}

function mapLinkingObservation(observation: LinkingObservationDto): LinkingObservation {
  return {
    ...observation,
    observed_at: new Date(observation.observed_at),
  }
}

function mapProjectRevision(revision: ProjectLinkRevisionDto): ProjectRevision {
  return {
    ...revision,
    created_at: new Date(revision.created_at),
  }
}

function mapProjectLineageEvent(event: ProjectLineageEventDto): ProjectLineageEvent {
  return {
    ...event,
    created_at: new Date(event.created_at),
  }
}

function mapProjectManualOverride(override: ProjectManualOverrideDto): ProjectManualOverride {
  return {
    ...override,
    created_at: new Date(override.created_at),
    updated_at: new Date(override.updated_at),
  }
}

function mapSourceStatus(source: SourceStatusDto): SourceStatus {
  return {
    ...source,
    last_sync: source.last_sync ? new Date(source.last_sync) : null,
  }
}

function mapMaskTemplate(template: MaskTemplateDto): MaskTemplate {
  return {
    ...template,
    created_at: new Date(template.created_at),
    updated_at: new Date(template.updated_at),
  }
}

function mapDriftReport(report: DriftReportDto): DriftReport {
  return {
    ...report,
    generated_at: new Date(report.generated_at),
    timeline: report.timeline.map((point) => ({
      ...point,
      date: new Date(`${point.date}T00:00:00.000Z`),
    })),
  }
}

function mapSearchResult(result: TurnSearchResultDto): SearchResult {
  return {
    turn: mapUserTurn(result.turn),
    session: mapSession(result.session ?? {
      id: result.turn.session_id,
      source_id: result.turn.source_id,
      source_platform: 'other',
      host_id: 'unknown',
      created_at: result.turn.created_at,
      updated_at: result.turn.last_context_activity_at,
      turn_count: 1,
      sync_axis: 'current',
    }),
    project: result.project ? mapProject(result.project) : undefined,
    match_highlights: result.highlights,
    relevance_score: result.relevance_score,
  }
}

function mapTurnLineage(lineage: PipelineLineageDto): TurnLineage {
  return {
    turn: mapUserTurn(lineage.turn),
    session: lineage.session ? mapSession(lineage.session) : undefined,
    candidate_chain: lineage.candidate_chain.map((candidate) => ({
      ...candidate,
      started_at: new Date(candidate.started_at),
      ended_at: new Date(candidate.ended_at),
    })),
    atoms: lineage.atoms.map((atom) => ({
      id: atom.id,
      actor_kind: atom.actor_kind,
      origin_kind: atom.origin_kind,
      content_kind: atom.content_kind,
      time_key: new Date(atom.time_key),
      payload: atom.payload,
      fragment_refs: atom.fragment_refs,
    })),
    edges: lineage.edges,
    fragments: lineage.fragments.map((fragment) => ({
      id: fragment.id,
      record_id: fragment.record_id,
      fragment_kind: fragment.fragment_kind,
      time_key: new Date(fragment.time_key),
      payload: fragment.payload,
      raw_refs: fragment.raw_refs,
    })),
    records: lineage.records.map((record) => ({
      id: record.id,
      blob_id: record.blob_id,
      record_path_or_offset: record.record_path_or_offset,
      observed_at: new Date(record.observed_at),
      parseable: record.parseable,
    })),
    blobs: lineage.blobs.map((blob) => ({
      id: blob.id,
      origin_path: blob.origin_path,
      captured_path: blob.captured_path,
      checksum: blob.checksum,
      size_bytes: blob.size_bytes,
      captured_at: new Date(blob.captured_at),
    })),
  }
}

function projectColor(projectId: string): string {
  let hash = 0
  for (const char of projectId) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue} 65% 45%)`
}
