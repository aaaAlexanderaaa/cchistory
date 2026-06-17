import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { UserTurnProjection } from "@cchistory/domain";

type PreparedStatement = ReturnType<DatabaseSync["prepare"]>;

export interface StorageBoundaryRebuildScopeSelector {
  source_id?: string;
  source_ids?: readonly string[];
  origin_path?: string;
  origin_paths?: readonly string[];
  session_id?: string;
  session_ids?: readonly string[];
  project_id?: string;
  project_ids?: readonly string[];
  parser_profile_id?: string;
  parser_profile_ids?: readonly string[];
}

export interface StorageBoundaryLedgerRef {
  source_id: string;
  origin_path: string;
  blob_id: string;
  evidence_sha256: string;
  parser_profile_id: string;
  sync_axis: string;
}

export interface StorageBoundaryRecordSpanRef {
  record_id: string;
  source_id: string;
  blob_id: string;
  session_ref: string;
  evidence_sha256: string;
  parser_profile_id: string;
  span_kind: string;
  start_byte?: number;
  end_byte?: number;
  span_label: string;
}

export interface StorageBoundaryTurnRef {
  turn_id: string;
  source_id: string;
  session_id: string;
  project_id?: string;
  link_state?: string;
  sync_axis?: string;
}

export interface StorageBoundaryContextRef {
  turn_id: string;
  source_id: string;
  context_evidence_sha256: string;
  cache_storage_path: string;
  full_context_bytes: number;
}

export interface StorageBoundaryDerivedCacheRef {
  id: string;
  cache_kind: string;
  source_id: string;
  scope_kind: string;
  scope_ref: string;
  parser_profile_id: string;
  evidence_sha256: string;
  item_count: number;
  payload_bytes: number;
}

export interface StorageBoundaryRebuildPlan {
  requested_scope: {
    source_ids: string[];
    origin_paths: string[];
    session_ids: string[];
    project_ids: string[];
    parser_profile_ids: string[];
  };
  source_ids: string[];
  origin_paths: string[];
  session_ids: string[];
  turn_ids: string[];
  project_ids: string[];
  parser_profile_ids: string[];
  blob_ids: string[];
  record_ids: string[];
  evidence_sha256s: string[];
  ledger_refs: StorageBoundaryLedgerRef[];
  record_span_refs: StorageBoundaryRecordSpanRef[];
  turn_refs: StorageBoundaryTurnRef[];
  context_refs: StorageBoundaryContextRef[];
  derived_cache_refs: StorageBoundaryDerivedCacheRef[];
}

export function planStorageBoundaryRebuildScope(input: {
  db: DatabaseSync;
  selector?: StorageBoundaryRebuildScopeSelector;
  listResolvedTurns: () => UserTurnProjection[];
  listProjectTurns: (projectId: string) => UserTurnProjection[];
}): StorageBoundaryRebuildPlan {
  const selector = input.selector ?? {};
  const requestedSourceIds = normalizeStringScope(selector.source_id, selector.source_ids);
  const requestedOriginPaths = normalizeStringScope(selector.origin_path, selector.origin_paths).map((entry) => path.normalize(entry));
  const requestedSessionIds = normalizeStringScope(selector.session_id, selector.session_ids);
  const requestedProjectIds = normalizeStringScope(selector.project_id, selector.project_ids);
  const requestedParserProfileIds = normalizeStringScope(selector.parser_profile_id, selector.parser_profile_ids);

  const ledgers = new Map<string, StorageBoundaryLedgerRef>();
  const spans = new Map<string, StorageBoundaryRecordSpanRef>();
  const turns = new Map<string, StorageBoundaryTurnRef>();
  const contexts = new Map<string, StorageBoundaryContextRef>();
  const caches = new Map<string, StorageBoundaryDerivedCacheRef>();
  const sourceIds = new Set<string>();
  const originPaths = new Set<string>();
  const sessionIds = new Set<string>();
  const projectIds = new Set<string>();
  const parserProfileIds = new Set<string>();
  const blobIds = new Set<string>();
  const recordIds = new Set<string>();
  const evidenceSha256s = new Set<string>();
  const resolvedTurnsById = new Map(input.listResolvedTurns().map((turn) => [turn.id, turn]));

  const addLedger = (row: LedgerRow): void => {
    const ledger: StorageBoundaryLedgerRef = {
      source_id: row.source_id,
      origin_path: path.normalize(row.origin_path),
      blob_id: row.blob_id,
      evidence_sha256: row.evidence_sha256,
      parser_profile_id: row.parser_profile_id,
      sync_axis: row.sync_axis,
    };
    ledgers.set(`${ledger.source_id}\0${ledger.origin_path}`, ledger);
    addNonEmpty(sourceIds, ledger.source_id);
    addNonEmpty(originPaths, ledger.origin_path);
    addNonEmpty(blobIds, ledger.blob_id);
    addNonEmpty(evidenceSha256s, ledger.evidence_sha256);
    addNonEmpty(parserProfileIds, ledger.parser_profile_id);
  };

  const addSpan = (row: RecordSpanRow): void => {
    const span: StorageBoundaryRecordSpanRef = {
      record_id: row.record_id,
      source_id: row.source_id,
      blob_id: row.blob_id,
      session_ref: row.session_ref,
      evidence_sha256: row.evidence_sha256,
      parser_profile_id: row.parser_profile_id,
      span_kind: row.span_kind,
      start_byte: row.start_byte ?? undefined,
      end_byte: row.end_byte ?? undefined,
      span_label: row.span_label,
    };
    spans.set(span.record_id, span);
    addNonEmpty(recordIds, span.record_id);
    addNonEmpty(sourceIds, span.source_id);
    addNonEmpty(blobIds, span.blob_id);
    addNonEmpty(sessionIds, span.session_ref);
    addNonEmpty(evidenceSha256s, span.evidence_sha256);
    addNonEmpty(parserProfileIds, span.parser_profile_id);
  };

  const addTurn = (row: TurnRow, projectId?: string): void => {
    const resolvedTurn = resolvedTurnsById.get(row.turn_id);
    const turn: StorageBoundaryTurnRef = {
      turn_id: row.turn_id,
      source_id: row.source_id,
      session_id: row.session_id,
      project_id: projectId ?? resolvedTurn?.project_id,
      link_state: row.link_state ?? resolvedTurn?.link_state,
      sync_axis: row.sync_axis ?? resolvedTurn?.sync_axis,
    };
    turns.set(turn.turn_id, turn);
    addNonEmpty(sourceIds, turn.source_id);
    addNonEmpty(sessionIds, turn.session_id);
    addNonEmpty(projectIds, turn.project_id);
  };

  const addContext = (row: ContextRow): void => {
    const context: StorageBoundaryContextRef = {
      turn_id: row.turn_id,
      source_id: row.source_id,
      context_evidence_sha256: row.context_evidence_sha256,
      cache_storage_path: row.cache_storage_path,
      full_context_bytes: row.full_context_bytes,
    };
    contexts.set(context.turn_id, context);
    addNonEmpty(sourceIds, context.source_id);
    addNonEmpty(evidenceSha256s, context.context_evidence_sha256);
  };

  const addCache = (row: CacheRow): void => {
    const cache: StorageBoundaryDerivedCacheRef = {
      id: row.id,
      cache_kind: row.cache_kind,
      source_id: row.source_id,
      scope_kind: row.scope_kind,
      scope_ref: row.scope_kind === "origin_path" ? path.normalize(row.scope_ref) : row.scope_ref,
      parser_profile_id: row.parser_profile_id,
      evidence_sha256: row.evidence_sha256,
      item_count: row.item_count,
      payload_bytes: row.payload_bytes,
    };
    caches.set(cache.id, cache);
    addNonEmpty(sourceIds, cache.source_id);
    addNonEmpty(parserProfileIds, cache.parser_profile_id);
    addNonEmpty(evidenceSha256s, cache.evidence_sha256);
    if (cache.scope_kind === "origin_path") {
      addNonEmpty(originPaths, cache.scope_ref);
    } else if (cache.scope_kind === "session") {
      addNonEmpty(sessionIds, cache.scope_ref);
    }
  };

  const selectLedgersBySource = input.db.prepare(ledgerSelectSql("WHERE source_id = ?"));
  const selectLedgersByOrigin = input.db.prepare(ledgerSelectSql("WHERE origin_path = ?"));
  const selectLedgersByBlob = input.db.prepare(ledgerSelectSql("WHERE source_id = ? AND current_blob_id = ?"));
  const selectLedgersByParserProfile = input.db.prepare(ledgerSelectSql("WHERE parser_profile_id = ?"));
  const selectSpansBySource = input.db.prepare(recordSpanSelectSql("WHERE source_id = ?"));
  const selectSpansByBlob = input.db.prepare(recordSpanSelectSql("WHERE source_id = ? AND blob_id = ?"));
  const selectSpansBySession = input.db.prepare(recordSpanSelectSql("WHERE session_ref = ?"));
  const selectSpansByParserProfile = input.db.prepare(recordSpanSelectSql("WHERE parser_profile_id = ?"));
  const selectTurnsBySource = input.db.prepare(turnSelectSql("WHERE source_id = ?"));
  const selectTurnsBySession = input.db.prepare(turnSelectSql("WHERE session_id = ?"));
  const selectTurnById = input.db.prepare(turnSelectSql("WHERE turn_id = ?"));
  const selectContextByTurn = input.db.prepare(contextSelectSql("WHERE turn_id = ?"));
  const selectContextsBySource = input.db.prepare(contextSelectSql("WHERE source_id = ?"));
  const selectCachesBySource = input.db.prepare(cacheSelectSql("WHERE source_id = ?"));
  const selectCachesByScope = input.db.prepare(cacheSelectSql("WHERE scope_kind = ? AND scope_ref = ?"));
  const selectCachesByParserProfile = input.db.prepare(cacheSelectSql("WHERE parser_profile_id = ?"));

  for (const sourceId of requestedSourceIds) {
    for (const row of allRows<LedgerRow>(selectLedgersBySource, sourceId)) addLedger(row);
    for (const row of allRows<RecordSpanRow>(selectSpansBySource, sourceId)) addSpan(row);
    for (const row of allRows<TurnRow>(selectTurnsBySource, sourceId)) addTurn(row);
    for (const row of allRows<ContextRow>(selectContextsBySource, sourceId)) addContext(row);
    for (const row of allRows<CacheRow>(selectCachesBySource, sourceId)) addCache(row);
  }
  for (const originPath of requestedOriginPaths) {
    for (const row of allRows<LedgerRow>(selectLedgersByOrigin, originPath)) addLedger(row);
    for (const row of allRows<CacheRow>(selectCachesByScope, "origin_path", originPath)) addCache(row);
  }
  for (const sessionId of requestedSessionIds) {
    addNonEmpty(sessionIds, sessionId);
    for (const row of allRows<RecordSpanRow>(selectSpansBySession, sessionId)) addSpan(row);
    for (const row of allRows<TurnRow>(selectTurnsBySession, sessionId)) addTurn(row);
    for (const row of allRows<CacheRow>(selectCachesByScope, "session", sessionId)) addCache(row);
  }
  for (const projectId of requestedProjectIds) {
    addNonEmpty(projectIds, projectId);
    for (const turn of input.listProjectTurns(projectId)) {
      const row = getRow<TurnRow>(selectTurnById, turn.id);
      addTurn(row ?? turnToRow(turn), projectId);
    }
  }
  for (const parserProfileId of requestedParserProfileIds) {
    addNonEmpty(parserProfileIds, parserProfileId);
    for (const row of allRows<LedgerRow>(selectLedgersByParserProfile, parserProfileId)) addLedger(row);
    for (const row of allRows<RecordSpanRow>(selectSpansByParserProfile, parserProfileId)) addSpan(row);
    for (const row of allRows<CacheRow>(selectCachesByParserProfile, parserProfileId)) addCache(row);
  }

  for (let pass = 0; pass < 5; pass += 1) {
    const before = scopeSizeKey({ ledgers, spans, turns, contexts, caches, sourceIds, originPaths, sessionIds });
    for (const ledger of [...ledgers.values()]) {
      for (const row of allRows<RecordSpanRow>(selectSpansByBlob, ledger.source_id, ledger.blob_id)) addSpan(row);
    }
    for (const span of [...spans.values()]) {
      for (const row of allRows<LedgerRow>(selectLedgersByBlob, span.source_id, span.blob_id)) addLedger(row);
    }
    for (const sessionId of [...sessionIds]) {
      for (const row of allRows<RecordSpanRow>(selectSpansBySession, sessionId)) addSpan(row);
      for (const row of allRows<TurnRow>(selectTurnsBySession, sessionId)) addTurn(row);
      for (const row of allRows<CacheRow>(selectCachesByScope, "session", sessionId)) addCache(row);
    }
    for (const turn of [...turns.values()]) {
      const context = getRow<ContextRow>(selectContextByTurn, turn.turn_id);
      if (context) addContext(context);
    }
    for (const sourceId of [...sourceIds]) {
      for (const row of allRows<CacheRow>(selectCachesByScope, "source", sourceId)) addCache(row);
    }
    for (const originPath of [...originPaths]) {
      for (const row of allRows<CacheRow>(selectCachesByScope, "origin_path", originPath)) addCache(row);
    }
    const after = scopeSizeKey({ ledgers, spans, turns, contexts, caches, sourceIds, originPaths, sessionIds });
    if (after === before) {
      break;
    }
  }

  return {
    requested_scope: {
      source_ids: sortStrings(requestedSourceIds),
      origin_paths: sortStrings(requestedOriginPaths),
      session_ids: sortStrings(requestedSessionIds),
      project_ids: sortStrings(requestedProjectIds),
      parser_profile_ids: sortStrings(requestedParserProfileIds),
    },
    source_ids: sortStrings([...sourceIds]),
    origin_paths: sortStrings([...originPaths]),
    session_ids: sortStrings([...sessionIds]),
    turn_ids: sortStrings([...turns.keys()]),
    project_ids: sortStrings([...projectIds]),
    parser_profile_ids: sortStrings([...parserProfileIds]),
    blob_ids: sortStrings([...blobIds]),
    record_ids: sortStrings([...recordIds]),
    evidence_sha256s: sortStrings([...evidenceSha256s]),
    ledger_refs: sortByComposite([...ledgers.values()], (entry) => [entry.source_id, entry.origin_path]),
    record_span_refs: sortByComposite([...spans.values()], (entry) => [entry.source_id, entry.session_ref, entry.record_id]),
    turn_refs: sortByComposite([...turns.values()], (entry) => [entry.source_id, entry.session_id, entry.turn_id]),
    context_refs: sortByComposite([...contexts.values()], (entry) => [entry.source_id, entry.turn_id]),
    derived_cache_refs: sortByComposite([...caches.values()], (entry) => [entry.source_id, entry.scope_kind, entry.scope_ref, entry.cache_kind]),
  };
}

interface LedgerRow {
  source_id: string;
  origin_path: string;
  blob_id: string;
  evidence_sha256: string;
  parser_profile_id: string;
  sync_axis: string;
}

interface RecordSpanRow {
  record_id: string;
  source_id: string;
  blob_id: string;
  session_ref: string;
  evidence_sha256: string;
  parser_profile_id: string;
  span_kind: string;
  start_byte: number | null;
  end_byte: number | null;
  span_label: string;
}

interface TurnRow {
  turn_id: string;
  source_id: string;
  session_id: string;
  link_state?: string;
  sync_axis?: string;
}

interface ContextRow {
  turn_id: string;
  source_id: string;
  context_evidence_sha256: string;
  cache_storage_path: string;
  full_context_bytes: number;
}

interface CacheRow {
  id: string;
  cache_kind: string;
  source_id: string;
  scope_kind: string;
  scope_ref: string;
  parser_profile_id: string;
  evidence_sha256: string;
  item_count: number;
  payload_bytes: number;
}

function ledgerSelectSql(whereClause: string): string {
  return `
    SELECT source_id,
           origin_path,
           current_blob_id AS blob_id,
           current_evidence_sha256 AS evidence_sha256,
           parser_profile_id,
           sync_axis
      FROM source_file_ledger
     ${whereClause}
  `;
}

function recordSpanSelectSql(whereClause: string): string {
  return `
    SELECT record_id,
           source_id,
           blob_id,
           session_ref,
           evidence_sha256,
           parser_profile_id,
           span_kind,
           start_byte,
           end_byte,
           span_label
      FROM parsed_record_spans
     ${whereClause}
  `;
}

function turnSelectSql(whereClause: string): string {
  return `
    SELECT turn_id,
           source_id,
           session_id,
           link_state,
           sync_axis
      FROM user_turns_v2
     ${whereClause}
  `;
}

function contextSelectSql(whereClause: string): string {
  return `
    SELECT turn_id,
           source_id,
           context_evidence_sha256,
           cache_storage_path,
           full_context_bytes
      FROM turn_context_refs_v2
     ${whereClause}
  `;
}

function cacheSelectSql(whereClause: string): string {
  return `
    SELECT id,
           cache_kind,
           source_id,
           scope_kind,
           scope_ref,
           parser_profile_id,
           evidence_sha256,
           item_count,
           payload_bytes
      FROM derived_cache_refs
     ${whereClause}
  `;
}

function turnToRow(turn: UserTurnProjection): TurnRow {
  return {
    turn_id: turn.id,
    source_id: turn.source_id,
    session_id: turn.session_id,
    link_state: turn.link_state,
    sync_axis: turn.sync_axis,
  };
}

function allRows<T>(statement: PreparedStatement, ...values: unknown[]): T[] {
  return (statement as { all: (...values: unknown[]) => unknown[] }).all(...values) as T[];
}

function getRow<T>(statement: PreparedStatement, ...values: unknown[]): T | undefined {
  return (statement as { get: (...values: unknown[]) => unknown }).get(...values) as T | undefined;
}

function normalizeStringScope(single?: string, many?: readonly string[]): string[] {
  const values = [single, ...(many ?? [])].filter((entry): entry is string => Boolean(entry?.trim()));
  return sortStrings([...new Set(values)]);
}

function addNonEmpty(target: Set<string>, value?: string): void {
  if (value?.trim()) {
    target.add(value);
  }
}

function sortStrings(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sortByComposite<T>(values: readonly T[], getKeys: (entry: T) => readonly string[]): T[] {
  return [...values].sort((left, right) => getKeys(left).join("\0").localeCompare(getKeys(right).join("\0")));
}

function scopeSizeKey(input: {
  ledgers: ReadonlyMap<string, unknown>;
  spans: ReadonlyMap<string, unknown>;
  turns: ReadonlyMap<string, unknown>;
  contexts: ReadonlyMap<string, unknown>;
  caches: ReadonlyMap<string, unknown>;
  sourceIds: ReadonlySet<string>;
  originPaths: ReadonlySet<string>;
  sessionIds: ReadonlySet<string>;
}): string {
  return [
    input.ledgers.size,
    input.spans.size,
    input.turns.size,
    input.contexts.size,
    input.caches.size,
    input.sourceIds.size,
    input.originPaths.size,
    input.sessionIds.size,
  ].join(":");
}
