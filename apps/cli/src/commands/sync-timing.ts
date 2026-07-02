import type { SourceStatus, StageKind } from "@cchistory/domain";
import type { SourceProbeProgressEvent } from "@cchistory/source-adapters";

export interface SourceTiming {
  startedAtMs: number;
  scanMs: number;
  parseMs: number;
  deriveMs: number;
  sqliteWriteMs: number;
  sqliteReplaceMs: number;
  sqliteMergeMs: number;
  sqliteMetadataMs: number;
  sqlitePruneMs: number;
  projectionRefreshMs: number;
  projectionRefreshSkipped: boolean;
  reuseLoadMs: number;
  totalMs: number;
  fileCount: number;
  batchCount: number;
  metadataOnlyReuseBatchCount: number;
  metadataOnlyWriteBatchCount: number;
}

export function createSourceTiming(): SourceTiming {
  return {
    startedAtMs: Date.now(),
    scanMs: 0,
    parseMs: 0,
    deriveMs: 0,
    sqliteWriteMs: 0,
    sqliteReplaceMs: 0,
    sqliteMergeMs: 0,
    sqliteMetadataMs: 0,
    sqlitePruneMs: 0,
    projectionRefreshMs: 0,
    projectionRefreshSkipped: false,
    reuseLoadMs: 0,
    totalMs: 0,
    fileCount: 0,
    batchCount: 0,
    metadataOnlyReuseBatchCount: 0,
    metadataOnlyWriteBatchCount: 0,
  };
}

export function recordProbeTiming(timing: SourceTiming, event: SourceProbeProgressEvent): void {
  const elapsedMs = typeof event.elapsed_ms === "number" ? event.elapsed_ms : undefined;
  if (event.stage === "list_files_done" && typeof event.count === "number") {
    timing.fileCount += event.count;
  }
  if (elapsedMs === undefined) {
    return;
  }

  switch (event.stage) {
    case "live_probe_done":
    case "list_files_done":
    case "file_capture_done":
    case "file_reuse":
    case "file_skip":
      timing.scanMs += elapsedMs;
      break;
    case "file_parse_done":
    case "file_append_done":
      timing.parseMs += elapsedMs;
      break;
    case "derive_done":
      timing.deriveMs += elapsedMs;
      break;
  }
}

export function buildSourceTimingStageStats(
  timing: SourceTiming,
): Partial<Record<StageKind, Record<string, number>>> {
  return {
    capture: {
      sync_scan_ms: timing.scanMs,
      sync_file_count: timing.fileCount,
      sync_batch_count: timing.batchCount,
      sync_metadata_only_reuse_batch_count: timing.metadataOnlyReuseBatchCount,
      sync_reuse_load_ms: timing.reuseLoadMs,
    },
    parse_source_fragments: {
      sync_parse_ms: timing.parseMs,
    },
    derive_candidates: {
      sync_derive_ms: timing.deriveMs,
    },
    finalize_projections: {
      sqlite_write_ms: timing.sqliteWriteMs,
      sqlite_replace_ms: timing.sqliteReplaceMs,
      sqlite_merge_ms: timing.sqliteMergeMs,
      sqlite_metadata_ms: timing.sqliteMetadataMs,
      sqlite_metadata_write_count: timing.metadataOnlyWriteBatchCount,
      sqlite_prune_ms: timing.sqlitePruneMs,
    },
    index_projections: {
      projection_refresh_ms: timing.projectionRefreshMs,
      projection_refresh_skipped: timing.projectionRefreshSkipped ? 1 : 0,
      sync_reindex_ms: timing.projectionRefreshMs,
      sync_total_ms: timing.totalMs,
    },
  };
}

export function buildSourceAggregateStageStats(
  source: SourceStatus,
  timing: SourceTiming,
  failureCounts: Partial<Record<StageKind, number>>,
): Partial<Record<StageKind, Record<string, number>>> {
  const stageCounts: Partial<Record<StageKind, Record<string, number>>> = {
    capture: {
      input_count: timing.fileCount || source.total_blobs,
      output_count: source.total_blobs,
      success_count: source.total_blobs,
      failure_count: failureCounts.capture ?? 0,
      skipped_count: 0,
      unparseable_count: 0,
    },
    extract_records: {
      input_count: source.total_blobs,
      output_count: source.total_records,
      success_count: source.total_records,
      failure_count: failureCounts.extract_records ?? 0,
      skipped_count: 0,
      unparseable_count: failureCounts.extract_records ?? 0,
    },
    parse_source_fragments: {
      input_count: source.total_records,
      output_count: source.total_fragments,
      success_count: source.total_fragments,
      failure_count: failureCounts.parse_source_fragments ?? 0,
      skipped_count: 0,
      unparseable_count: failureCounts.parse_source_fragments ?? 0,
    },
    atomize: {
      input_count: source.total_fragments,
      output_count: source.total_atoms,
      success_count: source.total_atoms,
      failure_count: failureCounts.atomize ?? 0,
      skipped_count: 0,
      unparseable_count: 0,
    },
    derive_candidates: {
      input_count: source.total_atoms,
      output_count: source.total_sessions + source.total_turns,
      success_count: source.total_sessions + source.total_turns,
      failure_count: failureCounts.derive_candidates ?? 0,
      skipped_count: 0,
      unparseable_count: 0,
    },
    finalize_projections: {
      input_count: source.total_sessions + source.total_turns,
      output_count: source.total_sessions + source.total_turns,
      success_count: source.total_sessions + source.total_turns,
      failure_count: failureCounts.finalize_projections ?? 0,
      skipped_count: 0,
      unparseable_count: 0,
      sessions: source.total_sessions,
      turns: source.total_turns,
    },
    apply_masks: {
      input_count: source.total_turns,
      output_count: source.total_turns,
      success_count: source.total_turns,
      failure_count: failureCounts.apply_masks ?? 0,
      skipped_count: 0,
      unparseable_count: 0,
      turns: source.total_turns,
    },
    index_projections: {
      input_count: source.total_turns,
      output_count: source.total_turns,
      success_count: source.total_turns,
      failure_count: failureCounts.index_projections ?? 0,
      skipped_count: 0,
      unparseable_count: 0,
      turns: source.total_turns,
    },
  };
  const timingStats = buildSourceTimingStageStats(timing);
  const mergedStats: Partial<Record<StageKind, Record<string, number>>> = {};
  for (const stage of Object.keys(stageCounts) as StageKind[]) {
    mergedStats[stage] = {
      ...stageCounts[stage],
      ...timingStats[stage],
    };
  }
  return mergedStats;
}
