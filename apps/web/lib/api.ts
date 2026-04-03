'use client'

import useSWR from 'swr'
import {
  createCCHistoryApiClient,
  type CreateSourceConfigRequest,
  type DeleteProjectResponse,
  type UpsertLinkingOverrideRequest,
} from '@cchistory/api-client'
import {
  mapDriftReport,
  mapLinkingReview,
  mapMaskTemplate,
  mapProject,
  mapProjectLineageEvent,
  mapProjectManualOverride,
  mapProjectRevision,
  mapSearchResults,
  mapSession,
  mapSessionRelatedWork,
  mapSourceStatus,
  mapUserTurns,
  mapTurnContext,
  mapTurnLineage,
  mapUserTurn,
  projectColor,
  type DriftReport,
  type LinkState,
  type LinkingReviewData,
  type MaskTemplate,
  type ProjectIdentity,
  type ProjectLineageEvent,
  type ProjectManualOverride,
  type ProjectRevision,
  type SearchResult,
  type Session,
  type SessionRelatedWork,
  type SourceStatus,
  type TurnContext,
  type TurnLineage,
  type UserTurn,
} from '@cchistory/presentation'
const DEFAULT_API_BASE_URL = '/api/cchistory'

export type { LinkingObservation, LinkingReviewData, SessionRelatedWork } from '@cchistory/presentation'

export function getApiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_CCHISTORY_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, '')
}

function getApiClient() {
  return createCCHistoryApiClient({ baseUrl: getApiBaseUrl() })
}

export function useTurnsQuery() {
  return useSWR<UserTurn[]>('/api/turns', async (path: string) => {
    void path
    const response = await getApiClient().getTurns()
    return mapUserTurns(response.turns)
  }, { revalidateOnFocus: false })
}

/**
 * Paginated turns query. Returns a page of turns with total count.
 * Use this when you need pagination; use useTurnsQuery() for full access.
 */
export function usePaginatedTurnsQuery(params: { limit: number; offset: number }) {
  return useSWR<{ turns: UserTurn[]; total: number }>(
    `/api/turns?limit=${params.limit}&offset=${params.offset}`,
    async () => {
      const response = await getApiClient().getTurns({ limit: params.limit, offset: params.offset })
      return { turns: mapUserTurns(response.turns), total: response.total }
    },
    { revalidateOnFocus: false },
  )
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

export function useSessionRelatedWorkQuery(sessionId?: string) {
  return useSWR<SessionRelatedWork[]>(
    sessionId ? `/api/admin/sessions/${encodeURIComponent(sessionId)}/related-work` : null,
    async () => (await getApiClient().getSessionRelatedWork(sessionId!)).map(mapSessionRelatedWork),
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
    async () => mapUserTurns(await getApiClient().getProjectTurns(projectId!, state)),
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
      return mapSearchResults(response)
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

export async function updateSourceConfig(sourceId: string, baseDir: string) {
  const response = await getApiClient().updateSourceConfig(sourceId, {
    base_dir: baseDir,
    sync: true,
  })
  return {
    source: mapSourceStatus(response.source),
    synced: response.synced,
  }
}

export async function createSourceConfig(payload: CreateSourceConfigRequest) {
  const response = await getApiClient().createSourceConfig({
    ...payload,
    sync: payload.sync ?? true,
  })
  return {
    source: mapSourceStatus(response.source),
    synced: response.synced,
  }
}

export async function resetSourceConfig(sourceId: string) {
  const response = await getApiClient().resetSourceConfig(sourceId, { sync: true })
  return {
    source: mapSourceStatus(response.source),
    synced: response.synced,
  }
}

export async function deleteProject(projectId: string, reason?: string): Promise<DeleteProjectResponse> {
  return getApiClient().deleteProject(projectId, reason ? { reason } : undefined)
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
