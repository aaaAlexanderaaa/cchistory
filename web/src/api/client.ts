import type {
  DistillArtifact,
  DistillSessionRequest,
  EntryDetail,
  EntryPage,
  SearchResult,
  SourceInfo,
} from "../types";

const BASE = "/api";

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

export async function getSources(): Promise<SourceInfo[]> {
  return fetchJSON(`${BASE}/sources`);
}

export async function getProjects(): Promise<Record<string, string[]>> {
  return fetchJSON(`${BASE}/sources/projects`);
}

export async function getEntries(params: {
  limit?: number;
  cursor?: string;
  source?: string;
  project?: string;
}): Promise<EntryPage> {
  const qs = new URLSearchParams();
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.source) qs.set("source", params.source);
  if (params.project) qs.set("project", params.project);

  const res = await fetch(`${BASE}/entries?${qs}`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  return {
    entries: await res.json(),
    nextCursor: res.headers.get("X-Next-Cursor"),
  };
}

export async function getEntry(entryId: string): Promise<EntryDetail> {
  return fetchJSON(`${BASE}/entries/${entryId}`);
}

export async function search(params: {
  q: string;
  sources?: string;
  types?: string;
  project?: string;
  limit?: number;
  offset?: number;
}): Promise<SearchResult> {
  const qs = new URLSearchParams();
  qs.set("q", params.q);
  if (params.sources) qs.set("sources", params.sources);
  if (params.types) qs.set("types", params.types);
  if (params.project) qs.set("project", params.project);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.offset) qs.set("offset", String(params.offset));
  return fetchJSON(`${BASE}/search?${qs}`);
}

export async function runDistill(
  payload: DistillSessionRequest
): Promise<DistillArtifact> {
  return fetchJSON(`${BASE}/distill/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}
