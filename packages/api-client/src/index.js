export class CCHistoryApiError extends Error {
    path;
    status;
    statusText;
    constructor(path, status, statusText) {
        super(`API request failed: ${status} ${statusText}`);
        this.name = "CCHistoryApiError";
        this.path = path;
        this.status = status;
        this.statusText = statusText;
    }
}
export function getDefaultApiBaseUrl() {
    return "http://127.0.0.1:8040";
}
export function createCCHistoryApiClient(options = {}) {
    const baseUrl = normalizeBaseUrl(options.baseUrl ?? getDefaultApiBaseUrl());
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (!fetchImpl) {
        throw new Error("A fetch implementation is required to create the API client.");
    }
    return {
        async getTurns() {
            return (await fetchJson(fetchImpl, baseUrl, "/api/turns")).turns;
        },
        async searchTurns(params) {
            const searchParams = new URLSearchParams();
            if (params.q)
                searchParams.set("q", params.q);
            if (params.project_id)
                searchParams.set("project_id", params.project_id);
            if (params.source_ids?.length)
                searchParams.set("source_ids", params.source_ids.join(","));
            if (params.link_states?.length)
                searchParams.set("link_states", params.link_states.join(","));
            if (params.value_axes?.length)
                searchParams.set("value_axes", params.value_axes.join(","));
            if (params.limit)
                searchParams.set("limit", String(params.limit));
            return (await fetchJson(fetchImpl, baseUrl, `/api/turns/search${searchParams.size > 0 ? `?${searchParams.toString()}` : ""}`)).results;
        },
        async getTurn(turnId) {
            return (await fetchJson(fetchImpl, baseUrl, `/api/turns/${encodeURIComponent(turnId)}`)).turn;
        },
        async getTurnContext(turnId) {
            return (await fetchJson(fetchImpl, baseUrl, `/api/turns/${encodeURIComponent(turnId)}/context`)).context;
        },
        async getSession(sessionId) {
            return (await fetchJson(fetchImpl, baseUrl, `/api/sessions/${encodeURIComponent(sessionId)}`)).session;
        },
        async getSessions() {
            return (await fetchJson(fetchImpl, baseUrl, "/api/sessions")).sessions;
        },
        async getSources() {
            return (await fetchJson(fetchImpl, baseUrl, "/api/sources")).sources;
        },
        async createSourceConfig(payload) {
            return fetchJsonWithBody(fetchImpl, baseUrl, "/api/admin/source-config", payload);
        },
        async updateSourceConfig(sourceId, payload) {
            return fetchJsonWithBody(fetchImpl, baseUrl, `/api/admin/source-config/${encodeURIComponent(sourceId)}`, payload);
        },
        async resetSourceConfig(sourceId, payload = {}) {
            return fetchJsonWithBody(fetchImpl, baseUrl, `/api/admin/source-config/${encodeURIComponent(sourceId)}/reset`, payload);
        },
        async getProjects(state = "all") {
            const suffix = state === "all" ? "?state=all" : `?state=${encodeURIComponent(state)}`;
            return (await fetchJson(fetchImpl, baseUrl, `/api/projects${suffix}`)).projects;
        },
        async getProjectTurns(projectId, state) {
            const suffix = state && state !== "all" ? `?state=${encodeURIComponent(state)}` : "";
            return (await fetchJson(fetchImpl, baseUrl, `/api/projects/${encodeURIComponent(projectId)}/turns${suffix}`)).turns;
        },
        async getProjectRevisions(projectId) {
            return fetchJson(fetchImpl, baseUrl, `/api/projects/${encodeURIComponent(projectId)}/revisions`);
        },
        async getLinkingReview() {
            return fetchJson(fetchImpl, baseUrl, "/api/admin/linking");
        },
        async getLinkingOverrides() {
            return (await fetchJson(fetchImpl, baseUrl, "/api/admin/linking/overrides")).overrides;
        },
        async upsertLinkingOverride(payload) {
            return fetchJsonWithBody(fetchImpl, baseUrl, "/api/admin/linking/overrides", payload);
        },
        async getMasks() {
            return (await fetchJson(fetchImpl, baseUrl, "/api/admin/masks")).templates;
        },
        async getDriftReport() {
            return fetchJson(fetchImpl, baseUrl, "/api/admin/drift");
        },
        async getTurnLineage(turnId) {
            return (await fetchJson(fetchImpl, baseUrl, `/api/admin/pipeline/lineage/${encodeURIComponent(turnId)}`)).lineage;
        },
        async getArtifacts(projectId) {
            const suffix = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
            return (await fetchJson(fetchImpl, baseUrl, `/api/artifacts${suffix}`)).artifacts;
        },
        async upsertArtifact(payload) {
            return fetchJsonWithBody(fetchImpl, baseUrl, "/api/artifacts", payload);
        },
        async getArtifactCoverage(artifactId) {
            return (await fetchJson(fetchImpl, baseUrl, `/api/artifacts/${encodeURIComponent(artifactId)}/coverage`)).coverage;
        },
        async runCandidateGc(payload) {
            return fetchJsonWithBody(fetchImpl, baseUrl, "/api/admin/lifecycle/candidate-gc", payload);
        },
        async getTombstone(logicalId) {
            return (await fetchJson(fetchImpl, baseUrl, `/api/tombstones/${encodeURIComponent(logicalId)}`)).tombstone;
        },
    };
}
async function fetchJson(fetchImpl, baseUrl, path) {
    const response = await fetchImpl(`${baseUrl}${path}`);
    if (!response.ok) {
        throw new CCHistoryApiError(path, response.status, response.statusText);
    }
    return (await response.json());
}
async function fetchJsonWithBody(fetchImpl, baseUrl, path, payload) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
        },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        throw new CCHistoryApiError(path, response.status, response.statusText);
    }
    return (await response.json());
}
function normalizeBaseUrl(value) {
    return value.replace(/\/$/, "");
}
//# sourceMappingURL=index.js.map