import type { HistoryEntry, SearchResult, SourceInfo } from "../types";

const BASE = "/api";

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

export async function getSources(): Promise<SourceInfo[]> {
  return fetchJSON(`${BASE}/sources`);
}

export async function getProjects(): Promise<Record<string, string[]>> {
  return fetchJSON(`${BASE}/sources/projects`);
}

export async function getHistory(params: {
  limit?: number;
  offset?: number;
  source?: string;
  project?: string;
}): Promise<HistoryEntry[]> {
  const qs = new URLSearchParams();
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.offset) qs.set("offset", String(params.offset));
  if (params.source) qs.set("source", params.source);
  if (params.project) qs.set("project", params.project);
  return fetchJSON(`${BASE}/history?${qs}`);
}

export async function getEntry(
  sourceName: string,
  entryId: string
): Promise<HistoryEntry> {
  return fetchJSON(`${BASE}/history/${sourceName}/${entryId}`);
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
