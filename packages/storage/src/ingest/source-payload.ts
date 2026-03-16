import type { DatabaseSync } from "node:sqlite";
import type { SourceStatus, SourceSyncPayload } from "@cchistory/domain";
import {
  hydrateSourceStatus,
  matchesReplaceableSourceIdentity,
  normalizeSourcePayload,
  normalizeSourceStatus,
} from "../internal/source-identity.js";
import { dedupeByKey, fromJson, toJson } from "../internal/utils.js";

export function replaceSourcePayload(db: DatabaseSync, payload: SourceSyncPayload): void {
  replaceSourcePayloadWithOptions(db, payload, { allow_host_rekey: false });
}

export function replaceSourcePayloadWithOptions(
  db: DatabaseSync,
  payload: SourceSyncPayload,
  options: { allow_host_rekey: boolean },
): void {
  const normalizedPayload = normalizeSourcePayload(payload);
  db.exec("BEGIN IMMEDIATE;");
  try {
    for (const sourceId of resolveReplaceSourceIds(db, normalizedPayload.source, options)) {
      deleteBySource(db, sourceId);
    }

    db
      .prepare("INSERT INTO source_instances (id, payload_json) VALUES (?, ?)")
      .run(normalizedPayload.source.id, toJson(normalizedPayload.source));

    const insertStageRun = db.prepare("INSERT INTO stage_runs (id, source_id, payload_json) VALUES (?, ?, ?)");
    for (const stageRun of normalizedPayload.stage_runs) {
      insertStageRun.run(stageRun.id, normalizedPayload.source.id, toJson(stageRun));
    }

    const insertLossAudit = db.prepare("INSERT INTO loss_audits (id, source_id, payload_json) VALUES (?, ?, ?)");
    for (const lossAudit of normalizedPayload.loss_audits) {
      insertLossAudit.run(lossAudit.id, normalizedPayload.source.id, toJson(lossAudit));
    }

    const insertBlob = db.prepare("INSERT INTO captured_blobs (id, source_id, payload_json) VALUES (?, ?, ?)");
    for (const blob of dedupeByKey(normalizedPayload.blobs, (entry) => entry.id)) {
      insertBlob.run(blob.id, normalizedPayload.source.id, toJson(blob));
    }

    const insertRecord = db.prepare(
      "INSERT INTO raw_records (id, source_id, session_ref, payload_json) VALUES (?, ?, ?, ?)",
    );
    for (const record of normalizedPayload.records) {
      insertRecord.run(record.id, normalizedPayload.source.id, record.session_ref, toJson(record));
    }

    const insertFragment = db.prepare(
      "INSERT INTO source_fragments (id, source_id, session_ref, payload_json) VALUES (?, ?, ?, ?)",
    );
    for (const fragment of normalizedPayload.fragments) {
      insertFragment.run(fragment.id, normalizedPayload.source.id, fragment.session_ref, toJson(fragment));
    }

    const insertAtom = db.prepare(
      "INSERT INTO conversation_atoms (id, source_id, session_ref, time_key, seq_no, payload_json) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const atom of normalizedPayload.atoms) {
      insertAtom.run(atom.id, normalizedPayload.source.id, atom.session_ref, atom.time_key, atom.seq_no, toJson(atom));
    }

    const insertEdge = db.prepare("INSERT INTO atom_edges (id, source_id, session_ref, from_atom_id, to_atom_id, payload_json) VALUES (?, ?, ?, ?, ?, ?)");
    for (const edge of normalizedPayload.edges) {
      insertEdge.run(edge.id, normalizedPayload.source.id, edge.session_ref, edge.from_atom_id, edge.to_atom_id, toJson(edge));
    }

    const insertCandidate = db.prepare(
      "INSERT INTO derived_candidates (id, source_id, session_ref, candidate_kind, payload_json) VALUES (?, ?, ?, ?, ?)",
    );
    for (const candidate of normalizedPayload.candidates) {
      insertCandidate.run(
        candidate.id,
        normalizedPayload.source.id,
        candidate.session_ref,
        candidate.candidate_kind,
        toJson(candidate),
      );
    }

    const insertSession = db.prepare(
      "INSERT INTO sessions (id, source_id, created_at, updated_at, payload_json) VALUES (?, ?, ?, ?, ?)",
    );
    for (const session of normalizedPayload.sessions) {
      insertSession.run(session.id, normalizedPayload.source.id, session.created_at, session.updated_at, toJson(session));
    }

    const insertTurn = db.prepare(
      "INSERT INTO user_turns (id, source_id, session_id, created_at, submission_started_at, payload_json) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const turn of normalizedPayload.turns) {
      insertTurn.run(
        turn.id,
        normalizedPayload.source.id,
        turn.session_id,
        turn.created_at,
        turn.submission_started_at,
        toJson(turn),
      );
    }

    const insertContext = db.prepare("INSERT INTO turn_contexts (turn_id, source_id, payload_json) VALUES (?, ?, ?)");
    for (const context of normalizedPayload.contexts) {
      insertContext.run(context.turn_id, normalizedPayload.source.id, toJson(context));
    }

    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function resolveReplaceSourceIds(
  db: DatabaseSync,
  incomingSource: SourceStatus,
  options: { allow_host_rekey: boolean },
): string[] {
  const normalizedIncoming = normalizeSourceStatus(incomingSource);
  const rows = db.prepare("SELECT payload_json FROM source_instances").all() as Array<{ payload_json: string }>;
  const matchingIds = rows
    .map((row) => hydrateSourceStatus(fromJson<SourceStatus>(row.payload_json)))
    .filter(
      (source) =>
        source.id === normalizedIncoming.id ||
        matchesReplaceableSourceIdentity(source, normalizedIncoming, {
          allowHostRekey: options.allow_host_rekey,
        }),
    )
    .map((source) => source.id);
  return [...new Set([normalizedIncoming.id, ...matchingIds])];
}

function deleteBySource(db: DatabaseSync, sourceId: string): void {
  const statements = [
    "DELETE FROM source_instances WHERE id = ?",
    "DELETE FROM stage_runs WHERE source_id = ?",
    "DELETE FROM loss_audits WHERE source_id = ?",
    "DELETE FROM captured_blobs WHERE source_id = ?",
    "DELETE FROM raw_records WHERE source_id = ?",
    "DELETE FROM source_fragments WHERE source_id = ?",
    "DELETE FROM conversation_atoms WHERE source_id = ?",
    "DELETE FROM atom_edges WHERE source_id = ?",
    "DELETE FROM derived_candidates WHERE source_id = ?",
    "DELETE FROM sessions WHERE source_id = ?",
    "DELETE FROM user_turns WHERE source_id = ?",
    "DELETE FROM turn_contexts WHERE source_id = ?",
  ];

  for (const statement of statements) {
    db.prepare(statement).run(sourceId);
  }
}
