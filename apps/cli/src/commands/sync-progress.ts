import type {
  SourceDefinition,
  SourceStatus,
  SourceSyncPayload,
} from "@cchistory/domain";
import type { SourceProbeProgressEvent } from "@cchistory/source-adapters";
import type { CommandContext } from "../main.js";

export type SyncProgressEvent = (
  | SourceProbeProgressEvent
  | {
      stage:
        | "store_open_start"
        | "store_open_done"
        | "source_resolution_start"
        | "source_resolution_done"
        | "host_probe_start"
        | "host_probe_done"
        | "source_prepare_start"
        | "source_prepare_done"
        | "incremental_reuse_load_start"
        | "incremental_reuse_load_done"
        | "write_store_start"
        | "write_store_done"
        | "reindex_start"
        | "reindex_done"
        | "reindex_skip"
        | "source_error";
      source_id?: string;
      slot_id?: string;
      platform?: SourceStatus["platform"];
      display_name?: string;
      message?: string;
      file_path?: string;
      file_index?: number;
      file_count?: number;
      size_bytes?: number;
      count?: number;
      elapsed_ms?: number;
      sqlite_merge_ms?: number;
    }
);

export type StorageProgressEvent =
  | {
      stage: "write_store_done";
      source_id: string;
      projection_changed: boolean;
    }
  | {
      stage: "reindex_start" | "reindex_done";
      source_id: string;
    };

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KiB`;
  return `${Math.round(bytes / (1024 * 1024))}MiB`;
}

export function createProgressReporter(
  context: CommandContext,
): ((event: SyncProgressEvent) => void) | undefined {
  const mode = context.options.progress ?? (context.options.detail || context.globals.verbose ? "text" : "none");
  if (mode === "none") {
    return undefined;
  }
  const command = context.commandPath[0] ?? "sync";

  return (event) => {
    if (mode === "jsonl") {
      context.io.stderr(`${JSON.stringify({ kind: `${command}-progress`, at: new Date().toISOString(), ...event })}\n`);
      return;
    }

    const prefix = `[${command}:${event.slot_id ?? "cli"}:${event.stage}]`;
    const fileProgress =
      typeof event.file_index === "number" && typeof event.file_count === "number"
        ? ` ${event.file_index}/${event.file_count}`
        : "";
    const elapsed = typeof event.elapsed_ms === "number" ? ` (${event.elapsed_ms}ms)` : "";
    const size = typeof event.size_bytes === "number" ? ` ${formatBytes(event.size_bytes)}` : "";
    context.io.stderr(`${prefix}${fileProgress}${size} ${event.message ?? event.file_path ?? ""}${elapsed}\n`);
  };
}

export function createFailedSourcePayload(
  source: SourceDefinition,
  hostId: string,
  errorMessage: string,
): SourceSyncPayload {
  const now = new Date().toISOString();
  return {
    source: {
      id: source.id,
      slot_id: source.slot_id,
      family: source.family,
      platform: source.platform,
      display_name: source.display_name,
      base_dir: source.base_dir,
      host_id: hostId,
      last_sync: now,
      sync_status: "error",
      error_message: errorMessage,
      total_blobs: 0,
      total_records: 0,
      total_fragments: 0,
      total_atoms: 0,
      total_sessions: 0,
      total_turns: 0,
    },
    stage_runs: [],
    loss_audits: [],
    blobs: [],
    records: [],
    fragments: [],
    atoms: [],
    edges: [],
    candidates: [],
    sessions: [],
    turns: [],
    contexts: [],
  };
}

export function formatStorageProgressMessage(
  stage: SyncProgressEvent["stage"],
  sourceName: string,
): string {
  switch (stage) {
    case "write_store_done":
      return `Wrote ${sourceName} payload to SQLite`;
    case "reindex_start":
      return "Rebuilding project links and search index";
    case "reindex_done":
      return "Rebuilt project links and search index";
    case "reindex_skip":
      return "Skipped project links and search index rebuild; canonical projections were unchanged";
    default:
      return sourceName;
  }
}
