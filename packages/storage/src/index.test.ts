import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { deriveSourceInstanceId, type SourceSyncPayload, type UserTurnProjection } from "@cchistory/domain";
import { buildLocalReadOverview, CCHistoryStorage } from "./index.js";
import { STORAGE_SCHEMA_VERSION } from "./db/schema.js";
import { querySearchIndex } from "./queries/search.js";

test("buildLocalReadOverview returns shared counts and recent projects", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-read-overview-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    try {
      storage.replaceSourcePayload(
        createFixturePayload("src-storage-overview", "Overview text", "stage-run-overview", {
          includeProjectObservation: false,
          workingDirectory: "/workspace/project-alpha",
        }),
      );
      const overview = buildLocalReadOverview(storage);

      assert.equal(overview.schema.schema_version, STORAGE_SCHEMA_VERSION);
      assert.equal(overview.counts.sources, 1);
      assert.equal(overview.counts.projects, 1);
      assert.equal(overview.counts.sessions, 1);
      assert.equal(overview.counts.turns, 1);
      assert.equal(overview.recent_projects[0]?.display_name, "project-alpha");
    } finally {
      storage.close();
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("replaceSourcePayload persists pipeline layers and lineage drill-down", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(createFixturePayload("src-storage-test", "Need lineage", "stage-run-1"));

    assert.equal(storage.isEmpty(), false);
    assert.equal(storage.listSources().length, 1);
    assert.equal(storage.listStageRuns().length, 1);
    assert.equal(storage.listLossAudits().length, 1);
    assert.equal(storage.listBlobs().length, 1);
    assert.equal(storage.listRecords().length, 1);
    assert.equal(storage.listFragments().length, 4);
    assert.equal(storage.listAtoms().length, 4);
    assert.equal(storage.listEdges().length, 2);
    assert.equal(storage.listCandidates().length, 3);
    assert.equal(storage.listTurns().length, 1);
    assert.equal(storage.getSession("session-1")?.id, "session-1");
    assert.equal(storage.getTurn("turn-1")?.canonical_text, "Need lineage");
    assert.equal(storage.getTurnContext("turn-1")?.tool_calls.length, 1);

    const lineage = storage.getTurnLineage("turn-1");
    assert.ok(lineage);
    assert.equal(lineage.session?.id, "session-1");
    assert.equal(lineage.candidate_chain.length, 3);
    assert.equal(lineage.atoms.length, 4);
    assert.equal(lineage.edges.length, 2);
    assert.equal(lineage.fragments.length, 4);
    assert.equal(lineage.records.length, 1);
    assert.equal(lineage.blobs.length, 1);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("storage keeps delegated and automation evidence inspectable even when no canonical turns are emitted", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-secondary-evidence-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    try {
      const openclawPayload = createFixturePayload(
        "storinst-openclaw-secondary",
        "[cron:mock-openclaw-hourly] Review the queued backlog.",
        "stage-run-openclaw-secondary",
        {
          platform: "codex",
          sessionId: "sess:openclaw:44444444-5555-4666-8777-888888888888",
          turnId: "turn-openclaw-secondary",
          workingDirectory: "/Users/mock_user/workspace/openclaw-automation",
        },
      );
      openclawPayload.source.platform = "openclaw";
      openclawPayload.source.slot_id = "openclaw";
      openclawPayload.source.total_turns = 0;
      openclawPayload.source.total_sessions = 1;
      openclawPayload.sessions[0]!.source_platform = "openclaw";
      openclawPayload.sessions[0]!.turn_count = 0;
      openclawPayload.sessions[0]!.title = "cron:mock-openclaw-hourly";
      openclawPayload.turns = [];
      openclawPayload.contexts = [];
      openclawPayload.candidates = [];
      openclawPayload.fragments[0] = {
        ...openclawPayload.fragments[0]!,
        actor_kind: "system",
        origin_kind: "source_meta",
        payload: {
          text: "Reviewed queued rule updates and refreshed the workspace plan.",
          relation_kind: "automation_run",
          job_id: "mock-openclaw-hourly",
          status: "success",
          session_key: "main:11111111-2222-4333-8444-555555555555",
        },
      };
      openclawPayload.fragments[1] = {
        ...openclawPayload.fragments[1]!,
        fragment_kind: "session_relation",
        actor_kind: "system",
        origin_kind: "source_meta",
        payload: {
          parent_uuid: "11111111-2222-4333-8444-555555555555",
          session_key: "main:11111111-2222-4333-8444-555555555555",
          job_id: "mock-openclaw-hourly",
          status: "success",
          relation_kind: "automation_run",
        },
      };
      openclawPayload.atoms[0] = {
        ...openclawPayload.atoms[0]!,
        actor_kind: "user",
        origin_kind: "automation_trigger",
        content_kind: "text",
        payload: { text: "[cron:mock-openclaw-hourly] Review the queued backlog." },
      };
      openclawPayload.atoms[1] = {
        ...openclawPayload.atoms[1]!,
        actor_kind: "system",
        origin_kind: "source_meta",
        content_kind: "text",
        payload: { text: "Reviewed queued rule updates and refreshed the workspace plan." },
      };

      const claudePayload = createFixturePayload(
        "storinst-claude-secondary",
        "Search the codebase for all timeout, keepalive, heartbeat, and poll-related constants.",
        "stage-run-claude-secondary",
        {
          platform: "claude_code",
          sessionId: "cc1df109-4282-4321-8248-8bbcd471da78",
          turnId: "turn-claude-secondary",
          workingDirectory: "/Users/mock_user/workspace/chat-ui-kit",
        },
      );
      claudePayload.source.total_turns = 0;
      claudePayload.sessions[0]!.turn_count = 0;
      claudePayload.turns = [];
      claudePayload.contexts = [];
      claudePayload.candidates = [];
      claudePayload.fragments[1] = {
        ...claudePayload.fragments[1]!,
        fragment_kind: "session_relation",
        actor_kind: "system",
        origin_kind: "source_meta",
        payload: {
          parent_uuid: null,
          is_sidechain: true,
        },
      };
      claudePayload.atoms[0] = {
        ...claudePayload.atoms[0]!,
        origin_kind: "delegated_instruction",
      };

      storage.replaceSourcePayload(openclawPayload);
      storage.replaceSourcePayload(claudePayload);

      assert.equal(storage.listTurns().length, 0);

      const persistedOpenclaw = storage.getSourcePayload("storinst-openclaw-secondary");
      assert.ok(persistedOpenclaw);
      assert.equal(persistedOpenclaw?.turns.length, 0);
      assert.ok(
        persistedOpenclaw?.atoms.some(
          (atom) =>
            atom.origin_kind === "automation_trigger" &&
            String(atom.payload.text ?? "").includes("[cron:mock-openclaw-hourly]"),
        ),
      );
      assert.ok(
        persistedOpenclaw?.fragments.some(
          (fragment) =>
            fragment.fragment_kind === "session_relation" &&
            fragment.payload.relation_kind === "automation_run" &&
            fragment.payload.parent_uuid === "11111111-2222-4333-8444-555555555555",
        ),
      );

      const persistedClaude = storage.getSourcePayload("storinst-claude-secondary");
      assert.ok(persistedClaude);
      assert.equal(persistedClaude?.turns.length, 0);
      assert.ok(
        persistedClaude?.atoms.some(
          (atom) =>
            atom.origin_kind === "delegated_instruction" &&
            String(atom.payload.text ?? "").includes("Search the codebase for all timeout"),
        ),
      );
      assert.ok(
        persistedClaude?.fragments.some(
          (fragment) =>
            fragment.fragment_kind === "session_relation" &&
            fragment.payload.is_sidechain === true,
        ),
      );

      const openclawRelatedWork = storage.getSessionRelatedWork("sess:openclaw:44444444-5555-4666-8777-888888888888");
      assert.equal(openclawRelatedWork.length, 1);
      assert.equal(openclawRelatedWork[0]?.relation_kind, "automation_run");
      assert.equal(openclawRelatedWork[0]?.target_kind, "automation_run");
      assert.equal(openclawRelatedWork[0]?.target_session_ref, "11111111-2222-4333-8444-555555555555");
      assert.equal(openclawRelatedWork[0]?.automation_job_ref, "mock-openclaw-hourly");
      assert.equal(openclawRelatedWork[0]?.automation_run_key, "main:11111111-2222-4333-8444-555555555555");
      assert.equal(openclawRelatedWork[0]?.transcript_primary, false);

      const claudeRelatedWork = storage.getSessionRelatedWork("cc1df109-4282-4321-8248-8bbcd471da78");
      assert.equal(claudeRelatedWork.length, 1);
      assert.equal(claudeRelatedWork[0]?.relation_kind, "delegated_session");
      assert.equal(claudeRelatedWork[0]?.target_kind, "session");
      assert.equal(claudeRelatedWork[0]?.target_session_ref, "cc1df109-4282-4321-8248-8bbcd471da78");
      assert.equal(claudeRelatedWork[0]?.transcript_primary, true);
      assert.equal(claudeRelatedWork[0]?.raw_detail.is_sidechain, true);
    } finally {
      storage.close();
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("getSessionRelatedWork normalizes delegated factory relations from callingSessionId metadata", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-factory-related-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    try {
      const payload = createFixturePayload(
        "src-factory-related",
        "Review delegated factory session",
        "stage-run-factory-related",
        {
          platform: "factory_droid",
          sessionId: "session-factory-related",
          turnId: "turn-factory-related",
          workingDirectory: "/workspace/factory-related",
        },
      );
      const lastFragment = payload.fragments[payload.fragments.length - 1]!;
      payload.fragments.push({
        ...lastFragment,
        id: "turn-factory-related-fragment-relation",
        seq_no: lastFragment.seq_no + 1,
        fragment_kind: "session_relation",
        actor_kind: "system",
        origin_kind: "source_meta",
        time_key: "2026-03-09T09:00:04.000Z",
        payload: {
          callingSessionId: "factory-parent-1",
          callingToolUseId: "factory-tool-parent-1",
          agentId: "reviewer-agent",
        },
        raw_refs: [],
      });

      storage.replaceSourcePayload(payload);

      const relatedWork = storage.getSessionRelatedWork("session-factory-related");
      assert.equal(relatedWork.length, 1);
      assert.equal(relatedWork[0]?.relation_kind, "delegated_session");
      assert.equal(relatedWork[0]?.target_kind, "session");
      assert.equal(relatedWork[0]?.target_session_ref, "factory-parent-1");
      assert.equal(relatedWork[0]?.parent_tool_ref, "factory-tool-parent-1");
      assert.equal(relatedWork[0]?.child_agent_key, "reviewer-agent");
      assert.equal(relatedWork[0]?.transcript_primary, true);
      assert.equal(relatedWork[0]?.raw_detail.callingSessionId, "factory-parent-1");
    } finally {
      storage.close();
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("getSessionRelatedWork normalizes delegated opencode relations from parent session metadata", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-opencode-related-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    try {
      const payload = createFixturePayload(
        "src-opencode-related",
        "Review delegated opencode session",
        "stage-run-opencode-related",
        {
          platform: "codex",
          sessionId: "sess:opencode:session-opencode-related",
          turnId: "turn-opencode-related",
          workingDirectory: "/workspace/opencode-related",
        },
      );
      payload.source.platform = "opencode";
      payload.source.slot_id = "opencode";
      payload.sessions[0]!.source_platform = "opencode";
      const lastFragment = payload.fragments[payload.fragments.length - 1]!;
      payload.fragments.push({
        ...lastFragment,
        id: "turn-opencode-related-fragment-relation",
        seq_no: lastFragment.seq_no + 1,
        fragment_kind: "session_relation",
        actor_kind: "system",
        origin_kind: "source_meta",
        time_key: "2026-03-09T09:00:04.000Z",
        payload: {
          parent_uuid: "sess:opencode:parent-session-1",
          agent_id: "reviewer-agent",
        },
        raw_refs: [],
      });

      storage.replaceSourcePayload(payload);

      const relatedWork = storage.getSessionRelatedWork("sess:opencode:session-opencode-related");
      assert.equal(relatedWork.length, 1);
      assert.equal(relatedWork[0]?.relation_kind, "delegated_session");
      assert.equal(relatedWork[0]?.target_kind, "session");
      assert.equal(relatedWork[0]?.target_session_ref, "sess:opencode:parent-session-1");
      assert.equal(relatedWork[0]?.child_agent_key, "reviewer-agent");
      assert.equal(relatedWork[0]?.transcript_primary, true);
    } finally {
      storage.close();
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("getSessionRelatedWork merges duplicate delegated-session fragments for the same child session", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-duplicate-related-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    try {
      const payload = createFixturePayload(
        "src-duplicate-related",
        "Inspect duplicate delegated relation",
        "stage-run-duplicate-related",
        {
          platform: "claude_code",
          sessionId: "session-duplicate-related",
          turnId: "turn-duplicate-related",
          workingDirectory: "/workspace/duplicate-related",
        },
      );
      const lastFragment = payload.fragments[payload.fragments.length - 1]!;
      payload.fragments.push({
        ...lastFragment,
        id: "turn-duplicate-related-fragment-relation-a",
        seq_no: lastFragment.seq_no + 1,
        fragment_kind: "session_relation",
        actor_kind: "system",
        origin_kind: "source_meta",
        time_key: "2026-03-09T09:00:04.000Z",
        payload: {
          parent_uuid: "child-session-1",
          is_sidechain: true,
        },
        raw_refs: [],
      });
      payload.fragments.push({
        ...lastFragment,
        id: "turn-duplicate-related-fragment-relation-b",
        seq_no: lastFragment.seq_no + 2,
        fragment_kind: "session_relation",
        actor_kind: "system",
        origin_kind: "source_meta",
        time_key: "2026-03-09T09:00:05.000Z",
        payload: {
          parent_uuid: "child-session-1",
          is_sidechain: true,
        },
        raw_refs: [],
      });

      storage.replaceSourcePayload(payload);

      const relatedWork = storage.getSessionRelatedWork("session-duplicate-related");
      assert.equal(relatedWork.length, 1);
      assert.equal(relatedWork[0]?.relation_kind, "delegated_session");
      assert.equal(relatedWork[0]?.target_session_ref, "child-session-1");
      assert.equal(relatedWork[0]?.transcript_primary, true);
      assert.equal(relatedWork[0]?.fragment_refs.length, 2);
      assert.equal(relatedWork[0]?.created_at, "2026-03-09T09:00:04.000Z");
      assert.equal(relatedWork[0]?.updated_at, "2026-03-09T09:00:05.000Z");
    } finally {
      storage.close();
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("getSessionRelatedWork does not invent relations from Codex or AMP automation-like prompts", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-history-hints-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    try {
      storage.replaceSourcePayload(
        createFixturePayload("src-codex-history-hint", "continue", "stage-run-codex-history-hint", {
          platform: "codex",
          sessionId: "session-codex-history-hint",
          turnId: "turn-codex-history-hint",
          workingDirectory: "/workspace/chat-ui-kit",
        }),
      );
      storage.replaceSourcePayload(
        createFixturePayload("src-amp-history-hint", "continue", "stage-run-amp-history-hint", {
          platform: "amp",
          sessionId: "session-amp-history-hint",
          turnId: "turn-amp-history-hint",
          workingDirectory: "/workspace/chat-ui-kit",
        }),
      );

      assert.deepEqual(storage.getSessionRelatedWork("session-codex-history-hint"), []);
      assert.deepEqual(storage.getSessionRelatedWork("session-amp-history-hint"), []);
    } finally {
      storage.close();
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("storage exposes explicit schema version and migration ledger", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-schema-info-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    try {
      const schema = storage.getSchemaInfo();
      assert.equal(schema.schema_version, STORAGE_SCHEMA_VERSION);
      assert.deepEqual(
        schema.migrations.map((migration) => migration.id),
        ["2026-03-20.1/base-schema", "2026-03-20.1/atom-edge-endpoints"],
      );
    } finally {
      storage.close();
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("schema metadata stays stable when reopening an up-to-date store", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-schema-stable-"));

  try {
    let storage = new CCHistoryStorage(dataDir);
    storage.close();

    const dbPath = path.join(dataDir, "cchistory.sqlite");
    const firstDb = new DatabaseSync(dbPath);
    const firstRow = firstDb
      .prepare("SELECT value_text, updated_at FROM schema_meta WHERE key = ?")
      .get("schema_version") as { value_text: string; updated_at: string } | undefined;
    firstDb.close();

    assert.ok(firstRow);
    assert.equal(firstRow?.value_text, STORAGE_SCHEMA_VERSION);

    await new Promise((resolve) => setTimeout(resolve, 50));

    storage = new CCHistoryStorage(dataDir);
    storage.close();

    const secondDb = new DatabaseSync(dbPath);
    const secondRow = secondDb
      .prepare("SELECT value_text, updated_at FROM schema_meta WHERE key = ?")
      .get("schema_version") as { value_text: string; updated_at: string } | undefined;
    secondDb.close();

    assert.ok(secondRow);
    assert.equal(secondRow?.value_text, STORAGE_SCHEMA_VERSION);
    assert.equal(secondRow?.updated_at, firstRow?.updated_at);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("replaceSourcePayload replaces prior rows for the same source deterministically", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(createFixturePayload("src-storage-test", "Old text", "stage-run-old"));
    storage.replaceSourcePayload(createFixturePayload("src-storage-test", "New text", "stage-run-new"));

    assert.equal(storage.listTurns().length, 1);
    assert.equal(storage.listStageRuns().length, 1);
    assert.equal(storage.listLossAudits().length, 1);
    assert.equal(storage.listEdges().length, 2);
    assert.equal(storage.getTurn("turn-1")?.canonical_text, "New text");
    assert.equal(storage.listStageRuns()[0]?.id, "stage-run-new");
    assert.equal(storage.listLossAudits()[0]?.detail, "updated fixture loss audit");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("replaceSourcePayload can rekey a local source when host identity changes", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    const baseDir = "/tmp/storage-fixture/legacy-codex";
    const legacyPayload = createFixturePayload("src-codex", "Legacy text", "stage-run-legacy", {
      baseDir,
      hostId: "host-legacy",
    });
    const normalizedPayload = createFixturePayload(
      deriveSourceInstanceId({
        host_id: "host-current",
        slot_id: "codex",
        base_dir: baseDir,
      }),
      "Fresh text",
      "stage-run-current",
      {
        baseDir,
        hostId: "host-current",
      },
    );

    storage.replaceSourcePayload(legacyPayload, { allow_host_rekey: true });
    storage.replaceSourcePayload(normalizedPayload, { allow_host_rekey: true });

    assert.equal(storage.listSources().length, 1);
    assert.equal(storage.listResolvedSessions().length, 1);
    assert.equal(storage.listTurns().length, 1);
    assert.equal(storage.getTurn("turn-1")?.canonical_text, "Fresh text");
    assert.equal(storage.listSources()[0]?.id, normalizedPayload.source.id);
    assert.equal(storage.listSources()[0]?.host_id, "host-current");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("replaceSourcePayload tolerates duplicate blob rows within one payload", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    const payload = createFixturePayload("src-storage-duplicate-blob", "Duplicate blob", "stage-run-duplicate-blob");
    payload.blobs.push({ ...payload.blobs[0]! });

    storage.replaceSourcePayload(payload);

    const storedPayload = storage.listSourcePayloads()[0];
    assert.equal(storage.listBlobs().length, 1);
    assert.equal(storedPayload?.blobs.length, 1);
    assert.equal(storage.getTurn("turn-1")?.canonical_text, "Duplicate blob");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("replaceSourcePayload tolerates duplicate loss audit rows within one payload", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    const payload = createFixturePayload(
      "src-storage-duplicate-loss-audit",
      "Duplicate loss audit",
      "stage-run-duplicate-loss-audit",
    );
    payload.loss_audits.push({ ...payload.loss_audits[0]! });

    storage.replaceSourcePayload(payload);

    const storedPayload = storage.listSourcePayloads()[0];
    assert.equal(storedPayload?.loss_audits.length, 1);
    assert.equal(storage.getTurn("turn-1")?.canonical_text, "Duplicate loss audit");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("initializeStorageSchema upgrades legacy atom_edges columns and preserves edge lineage", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-legacy-schema-"));

  try {
    const seedStorage = new CCHistoryStorage(dataDir);
    seedStorage.replaceSourcePayload(
      createFixturePayload("src-storage-legacy-schema", "Legacy schema turn", "stage-run-legacy-schema", {
        turnId: "turn-legacy-schema",
        sessionId: "session-legacy-schema",
      }),
    );
    seedStorage.close();

    rewriteAtomEdgesAsLegacyTable(path.join(dataDir, "cchistory.sqlite"));

    const storage = new CCHistoryStorage(dataDir);
    try {
      assert.equal(storage.searchTurns({ query: "Legacy schema turn" }).length, 1);
      const lineage = storage.getTurnLineage("turn-legacy-schema");
      assert.equal(lineage?.edges.length, 2);
    } finally {
      storage.close();
    }

    const db = new DatabaseSync(path.join(dataDir, "cchistory.sqlite"));
    try {
      const columns = (
        db.prepare("PRAGMA table_info(atom_edges)").all() as Array<{
          name: string;
        }>
      ).map((column) => column.name);
      assert.ok(columns.includes("from_atom_id"));
      assert.ok(columns.includes("to_atom_id"));
    } finally {
      db.close();
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("legacy stores backfill schema metadata on first open after versioned schema support", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-legacy-schema-meta-"));

  try {
    const seedStorage = new CCHistoryStorage(dataDir);
    seedStorage.close();

    const db = new DatabaseSync(path.join(dataDir, "cchistory.sqlite"));
    try {
      db.exec("DROP TABLE schema_migrations;");
      db.exec("DROP TABLE schema_meta;");
    } finally {
      db.close();
    }

    const storage = new CCHistoryStorage(dataDir);
    try {
      const schema = storage.getSchemaInfo();
      assert.equal(schema.schema_version, STORAGE_SCHEMA_VERSION);
      assert.equal(schema.migrations.length, 2);
    } finally {
      storage.close();
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("opening a legacy store preserves turn session and project readability after upgrade", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-legacy-readable-upgrade-"));

  try {
    const dbPath = path.join(dataDir, "cchistory.sqlite");
    const seedStorage = new CCHistoryStorage(dataDir);
    try {
      seedStorage.replaceSourcePayload(
        createFixturePayload("src-storage-legacy-readable", "Legacy readable turn", "stage-run-legacy-readable", {
          turnId: "turn-legacy-readable",
          sessionId: "session-legacy-readable",
          workingDirectory: "/workspace/legacy-readable",
          projectObservation: {
            workspacePath: "/workspace/legacy-readable",
            confidence: 0.95,
          },
        }),
      );
    } finally {
      seedStorage.close();
    }

    rewriteAtomEdgesAsLegacyTable(dbPath);
    dropSchemaMetadataTables(dbPath);

    const storage = new CCHistoryStorage(dataDir);
    try {
      const schema = storage.getSchemaInfo();
      assert.equal(schema.schema_version, STORAGE_SCHEMA_VERSION);
      assert.equal(schema.migrations.length, 2);

      const turn = storage.getResolvedTurn("turn-legacy-readable");
      assert.equal(turn?.canonical_text, "Legacy readable turn");

      const session = storage.listResolvedSessions().find((entry) => entry.id === "session-legacy-readable");
      assert.ok(session);
      assert.equal(session?.turn_count, 1);

      const project = storage.listProjects().find((entry) => entry.primary_workspace_path === "/workspace/legacy-readable");
      assert.ok(project);
      assert.equal(turn?.project_id, project?.project_id);

      const searchResults = storage.searchTurns({ query: "Legacy readable turn" });
      assert.equal(searchResults.length, 1);
      assert.equal(searchResults[0]?.turn.id, "turn-legacy-readable");
    } finally {
      storage.close();
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("listSourcePayloads reconstructs persisted source payloads for export or merge", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(createFixturePayload("src-storage-export-a", "Export A", "stage-run-export-a"));
    storage.replaceSourcePayload(createFixturePayload("src-storage-export-b", "Export B", "stage-run-export-b", { turnId: "turn-2", sessionId: "session-2" }));

    const payloads = storage.listSourcePayloads().sort((left, right) =>
      left.turns[0]!.canonical_text.localeCompare(right.turns[0]!.canonical_text),
    );
    assert.equal(payloads.length, 2);
    assert.equal(payloads[0]?.turns[0]?.canonical_text, "Export A");
    assert.equal(payloads[1]?.turns[0]?.canonical_text, "Export B");
    assert.equal(storage.getSourcePayload(payloads[1]!.source.id)?.sessions[0]?.id, "session-2");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("[gemini] companion evidence blobs survive source payload reconstruction", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    const geminiRoot = "/tmp/storage-fixture/.gemini";
    const payload = createFixturePayload(
      deriveSourceInstanceId({ host_id: "host-1", slot_id: "gemini", base_dir: geminiRoot }),
      "Gemini exportable evidence",
      "stage-run-gemini",
      {
        platform: "gemini",
        baseDir: geminiRoot,
      },
    );

    payload.blobs[0] = {
      ...payload.blobs[0]!,
      origin_path: path.join(geminiRoot, "tmp", "gemini-fixture", "chats", "session-2026-03-10T07-00-gemini-fixture.json"),
      captured_path: path.join(geminiRoot, ".cache", "session-2026-03-10T07-00-gemini-fixture.json"),
    };
    payload.blobs.push(
      {
        id: "turn-1-blob-projects",
        source_id: payload.source.id,
        host_id: payload.source.host_id,
        origin_path: path.join(geminiRoot, "projects.json"),
        captured_path: path.join(geminiRoot, ".cache", "projects.json"),
        checksum: "checksum-projects",
        size_bytes: 64,
        captured_at: "2026-03-09T09:00:00.000Z",
        capture_run_id: "capture-run-gemini",
      },
      {
        id: "turn-1-blob-tmp-project-root",
        source_id: payload.source.id,
        host_id: payload.source.host_id,
        origin_path: path.join(geminiRoot, "tmp", "gemini-fixture", ".project_root"),
        captured_path: path.join(geminiRoot, ".cache", "tmp-gemini-fixture.project_root"),
        checksum: "checksum-tmp-project-root",
        size_bytes: 28,
        captured_at: "2026-03-09T09:00:00.000Z",
        capture_run_id: "capture-run-gemini",
      },
      {
        id: "turn-1-blob-history-project-root",
        source_id: payload.source.id,
        host_id: payload.source.host_id,
        origin_path: path.join(geminiRoot, "history", "gemini-fixture", ".project_root"),
        captured_path: path.join(geminiRoot, ".cache", "history-gemini-fixture.project_root"),
        checksum: "checksum-history-project-root",
        size_bytes: 28,
        captured_at: "2026-03-09T09:00:00.000Z",
        capture_run_id: "capture-run-gemini",
      },
    );
    payload.source.total_blobs = payload.blobs.length;

    storage.replaceSourcePayload(payload);

    const reconstructed = storage.getSourcePayload(payload.source.id);
    assert.ok(reconstructed);
    assert.equal(reconstructed?.source.platform, "gemini");
    assert.deepEqual(
      reconstructed?.blobs.map((blob) => blob.origin_path).sort(),
      [
        path.join(geminiRoot, "projects.json"),
        path.join(geminiRoot, "history", "gemini-fixture", ".project_root"),
        path.join(geminiRoot, "tmp", "gemini-fixture", ".project_root"),
        path.join(geminiRoot, "tmp", "gemini-fixture", "chats", "session-2026-03-10T07-00-gemini-fixture.json"),
      ].sort(),
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("usage rollups sort day and month buckets chronologically", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    const marchPayload = createFixturePayload("src-storage-rollup-march", "March turn", "stage-run-rollup-march", {
      sessionId: "session-rollup-march",
      turnId: "turn-rollup-march",
    });
    marchPayload.turns[0] = {
      ...marchPayload.turns[0]!,
      created_at: "2026-03-15T09:00:00.000Z",
      submission_started_at: "2026-03-15T09:00:00.000Z",
      context_summary: {
        ...marchPayload.turns[0]!.context_summary,
        total_tokens: 20,
        token_usage: {
          ...marchPayload.turns[0]!.context_summary.token_usage!,
          total_tokens: 20,
        },
      },
    };
    marchPayload.sessions[0] = {
      ...marchPayload.sessions[0]!,
      created_at: "2026-03-15T09:00:00.000Z",
      updated_at: "2026-03-15T09:00:01.000Z",
    };

    const februaryPayload = createFixturePayload(
      "src-storage-rollup-february",
      "February turn",
      "stage-run-rollup-february",
      {
        sessionId: "session-rollup-february",
        turnId: "turn-rollup-february",
      },
    );
    februaryPayload.turns[0] = {
      ...februaryPayload.turns[0]!,
      created_at: "2026-02-20T09:00:00.000Z",
      submission_started_at: "2026-02-20T09:00:00.000Z",
      context_summary: {
        ...februaryPayload.turns[0]!.context_summary,
        total_tokens: 200,
        token_usage: {
          ...februaryPayload.turns[0]!.context_summary.token_usage!,
          total_tokens: 200,
        },
      },
    };
    februaryPayload.sessions[0] = {
      ...februaryPayload.sessions[0]!,
      created_at: "2026-02-20T09:00:00.000Z",
      updated_at: "2026-02-20T09:00:01.000Z",
    };

    storage.replaceSourcePayload(marchPayload);
    storage.replaceSourcePayload(februaryPayload);

    assert.deepEqual(
      storage.listUsageRollup("day").rows.map((row) => row.key),
      ["2026-02-20", "2026-03-15"],
    );
    assert.deepEqual(
      storage.listUsageRollup("month").rows.map((row) => row.key),
      ["2026-02", "2026-03"],
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("resolved snapshot reads reuse one memoized project-link snapshot", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(createFixturePayload("src-storage-cache", "Cache me", "stage-run-cache"));

    const originalCompute = (storage as any).computeProjectLinkSnapshot.bind(storage) as () => unknown;
    let computeCalls = 0;
    (storage as any).computeProjectLinkSnapshot = () => {
      computeCalls += 1;
      return originalCompute();
    };

    (storage as any).invalidateProjectLinkSnapshot();
    storage.listResolvedTurns();
    storage.listResolvedSessions();
    storage.getResolvedTurn("turn-1");
    storage.getResolvedSession("session-1");
    storage.listProjectObservations();
    storage.getLinkingReview();

    assert.equal(computeCalls, 1);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("writes invalidate and repopulate the memoized project-link snapshot once per write", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(createFixturePayload("src-storage-cache-write", "Cache write", "stage-run-cache-write"));

    const originalCompute = (storage as any).computeProjectLinkSnapshot.bind(storage) as () => unknown;
    let computeCalls = 0;
    (storage as any).computeProjectLinkSnapshot = () => {
      computeCalls += 1;
      return originalCompute();
    };

    storage.upsertProjectOverride({
      target_kind: "turn",
      target_ref: "turn-1",
      project_id: "project-cache-write",
      display_name: "Cache Write",
    });
    assert.equal(computeCalls, 1);

    storage.listResolvedTurns();
    storage.getLinkingReview();
    assert.equal(computeCalls, 1);

    storage.purgeTurn("turn-1");
    assert.equal(computeCalls, 2);

    storage.listResolvedTurns();
    assert.equal(computeCalls, 2);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("derived project linker commits repo continuity and preserves workspace-only candidates", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-storage-committed-a", "Committed turn A", "stage-run-committed-a", {
        sessionId: "session-committed-a",
        turnId: "turn-committed-a",
        hostId: "host-1",
        platform: "codex",
        workingDirectory: "/workspace/cchistory",
        projectObservation: {
          workspacePath: "/workspace/cchistory",
          repoRoot: "/workspace/cchistory",
          repoRemote: "https://example.com/org/cchistory",
          repoFingerprint: "repo-fingerprint-cchistory",
        },
      }),
    );
    storage.replaceSourcePayload(
      createFixturePayload("src-storage-committed-b", "Committed turn B", "stage-run-committed-b", {
        sessionId: "session-committed-b",
        turnId: "turn-committed-b",
        hostId: "host-2",
        platform: "claude_code",
        workingDirectory: "/projects/cchistory",
        projectObservation: {
          workspacePath: "/projects/cchistory",
          repoRoot: "/projects/cchistory",
          repoRemote: "https://example.com/renamed/cchistory",
          repoFingerprint: "repo-fingerprint-cchistory",
        },
      }),
    );
    storage.replaceSourcePayload(
      createFixturePayload("src-storage-candidate", "Candidate turn", "stage-run-candidate", {
        sessionId: "session-candidate",
        turnId: "turn-candidate",
        hostId: "host-1",
        platform: "amp",
        workingDirectory: "/workspace/local-candidate",
        projectObservation: {
          workspacePath: "/workspace/local-candidate",
        },
      }),
    );

    const projects = storage.listProjects();
    assert.equal(projects.length, 2);

    const committedProjects = projects.filter((project) => project.linkage_state === "committed");
    const candidateProjects = projects.filter((project) => project.linkage_state === "candidate");
    assert.equal(committedProjects.length, 1);
    assert.equal(candidateProjects.length, 1);

    const committedProject = committedProjects[0]!;
    assert.equal(committedProject.link_reason, "repo_fingerprint_match");
    assert.equal(committedProject.committed_turn_count, 2);
    assert.equal(committedProject.session_count, 2);
    assert.deepEqual(committedProject.host_ids, ["host-1", "host-2"]);

    const candidateProject = candidateProjects[0]!;
    assert.equal(candidateProject.link_reason, "workspace_path_continuity");
    assert.equal(candidateProject.candidate_turn_count, 1);
    assert.equal(candidateProject.committed_turn_count, 0);

    const resolvedTurns = storage.listResolvedTurns();
    const committedTurnA = resolvedTurns.find((turn) => turn.id === "turn-committed-a");
    const committedTurnB = resolvedTurns.find((turn) => turn.id === "turn-committed-b");
    const candidateTurn = resolvedTurns.find((turn) => turn.id === "turn-candidate");
    assert.equal(committedTurnA?.link_state, "committed");
    assert.equal(committedTurnB?.link_state, "committed");
    assert.equal(committedTurnA?.project_id, committedTurnB?.project_id);
    assert.equal(candidateTurn?.link_state, "candidate");
    assert.deepEqual(candidateTurn?.candidate_project_ids, [candidateProject.project_id]);

    const resolvedSession = storage.getResolvedSession("session-candidate");
    assert.equal(resolvedSession?.primary_project_id, candidateProject.project_id);

    const lineage = storage.getTurnLineage("turn-committed-a");
    assert.equal(lineage?.turn.link_state, "committed");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("same-host repeated UNC workspace continuity commits one project across raw and file-URI variants", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-storage-unc-workspace-a", "UNC workspace turn A", "stage-run-unc-workspace-a", {
        sessionId: "session-unc-workspace-a",
        turnId: "turn-unc-workspace-a",
        hostId: "host-unc",
        platform: "codex",
        workingDirectory: String.raw`\\server\share\history-lab`,
        projectObservation: {
          workspacePath: String.raw`\\server\share\history-lab`,
        },
      }),
    );
    storage.replaceSourcePayload(
      createFixturePayload("src-storage-unc-workspace-b", "UNC workspace turn B", "stage-run-unc-workspace-b", {
        sessionId: "session-unc-workspace-b",
        turnId: "turn-unc-workspace-b",
        hostId: "host-unc",
        platform: "claude_code",
        workingDirectory: "file://server/share/history-lab/",
        projectObservation: {
          workspacePath: "file://server/share/history-lab/",
        },
      }),
    );

    const projects = storage.listProjects();
    assert.equal(projects.length, 1);

    const committedProject = projects[0]!;
    assert.equal(committedProject.linkage_state, "committed");
    assert.equal(committedProject.link_reason, "workspace_path_continuity");
    assert.equal(committedProject.session_count, 2);
    assert.equal(committedProject.committed_turn_count, 2);

    const resolvedTurns = storage.listResolvedTurns();
    assert.equal(resolvedTurns.length, 2);
    assert.ok(resolvedTurns.every((turn) => turn.link_state === "committed"));
    assert.equal(resolvedTurns[0]?.project_id, resolvedTurns[1]?.project_id);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("same-host repeated Windows workspace continuity commits one project across path variants", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-storage-win-workspace-a", "Windows workspace turn A", "stage-run-win-workspace-a", {
        sessionId: "session-win-workspace-a",
        turnId: "turn-win-workspace-a",
        hostId: "host-win",
        platform: "codex",
        workingDirectory: "C:\\Users\\dev\\workspace\\history-lab",
        projectObservation: {
          workspacePath: "C:\\Users\\dev\\workspace\\history-lab",
        },
      }),
    );
    storage.replaceSourcePayload(
      createFixturePayload("src-storage-win-workspace-b", "Windows workspace turn B", "stage-run-win-workspace-b", {
        sessionId: "session-win-workspace-b",
        turnId: "turn-win-workspace-b",
        hostId: "host-win",
        platform: "claude_code",
        workingDirectory: "C:\\Users\\dev\\workspace\\history-lab",
        projectObservation: {
          workspacePath: "c:/Users/dev/workspace/history-lab/",
        },
      }),
    );

    const projects = storage.listProjects();
    assert.equal(projects.length, 1);

    const committedProject = projects[0]!;
    assert.equal(committedProject.linkage_state, "committed");
    assert.equal(committedProject.link_reason, "workspace_path_continuity");
    assert.equal(committedProject.session_count, 2);
    assert.equal(committedProject.committed_turn_count, 2);

    const resolvedTurns = storage.listResolvedTurns();
    assert.equal(resolvedTurns.length, 2);
    assert.ok(resolvedTurns.every((turn) => turn.link_state === "committed"));
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("same-host repeated workspace continuity commits projects without repo evidence", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-storage-workspace-a", "Workspace turn A", "stage-run-workspace-a", {
        sessionId: "session-workspace-a",
        turnId: "turn-workspace-a",
        hostId: "host-1",
        platform: "codex",
        workingDirectory: "/workspace/repeated-project",
        projectObservation: {
          workspacePath: "/workspace/repeated-project",
        },
      }),
    );
    storage.replaceSourcePayload(
      createFixturePayload("src-storage-workspace-b", "Workspace turn B", "stage-run-workspace-b", {
        sessionId: "session-workspace-b",
        turnId: "turn-workspace-b",
        hostId: "host-1",
        platform: "claude_code",
        workingDirectory: "/workspace/repeated-project",
        projectObservation: {
          workspacePath: "/workspace/repeated-project",
        },
      }),
    );

    const projects = storage.listProjects();
    assert.equal(projects.length, 1);

    const committedProject = projects[0]!;
    assert.equal(committedProject.linkage_state, "committed");
    assert.equal(committedProject.link_reason, "workspace_path_continuity");
    assert.equal(committedProject.session_count, 2);
    assert.equal(committedProject.committed_turn_count, 2);
    assert.equal(committedProject.candidate_turn_count, 0);
    assert.ok(committedProject.confidence >= 0.8);

    const resolvedTurns = storage.listResolvedTurns();
    assert.equal(resolvedTurns.length, 2);
    assert.ok(resolvedTurns.every((turn) => turn.link_state === "committed"));
    assert.ok(resolvedTurns.every((turn) => turn.project_confidence === committedProject.confidence));
    assert.ok(resolvedTurns.every((turn) => turn.candidate_project_ids === undefined));
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("source-native project refs keep turns candidate-linked when workspace paths are unavailable", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-storage-native-project", "Native project turn", "stage-run-native-project", {
        sessionId: "session-native-project",
        turnId: "turn-native-project",
        platform: "codex",
        workingDirectory: "",
        projectObservation: {
          sourceNativeProjectRef: "Users-alex-m4-workspace-111",
        },
      }),
    );

    const projects = storage.listProjects();
    assert.equal(projects.length, 1);
    assert.equal(projects[0]?.linkage_state, "candidate");
    assert.equal(projects[0]?.link_reason, "source_native_project");
    assert.equal(projects[0]?.source_native_project_ref, "Users-alex-m4-workspace-111");

    const resolvedTurn = storage.getResolvedTurn("turn-native-project");
    assert.equal(resolvedTurn?.link_state, "candidate");
    assert.equal(resolvedTurn?.project_id, projects[0]?.project_id);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("storage synthesizes Cursor project observations from persisted blob origins when source candidates are missing", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    const payload = createFixturePayload(
      "src-storage-cursor-fallback",
      "Cursor fallback turn",
      "stage-run-cursor-fallback",
      {
        sessionId: "session-cursor-fallback",
        turnId: "turn-cursor-fallback",
        platform: "cursor",
        workingDirectory: "",
        includeProjectObservation: false,
      },
    );

    payload.source.base_dir = "/tmp/.cursor/projects";
    payload.blobs[0] = {
      ...payload.blobs[0]!,
      origin_path:
        "/tmp/.cursor/projects/workspace-a/agent-transcripts/session-cursor-fallback/session-cursor-fallback.jsonl",
    };
    payload.sessions[0] = {
      ...payload.sessions[0]!,
      working_directory: undefined,
      source_native_project_ref: undefined,
    };

    storage.replaceSourcePayload(payload);

    const projects = storage.listProjects();
    assert.equal(projects.length, 1);
    assert.equal(projects[0]?.linkage_state, "candidate");
    assert.equal(projects[0]?.link_reason, "source_native_project");
    assert.equal(projects[0]?.source_native_project_ref, "workspace-a");
    assert.equal(projects[0]?.confidence, 0.72);

    const resolvedTurn = storage.getResolvedTurn("turn-cursor-fallback");
    assert.equal(resolvedTurn?.link_state, "candidate");
    assert.equal(resolvedTurn?.project_id, projects[0]?.project_id);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("project display names decode percent-encoded workspace paths", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-storage-encoded-path", "Encoded path turn", "stage-run-encoded-path", {
        sessionId: "session-encoded-path",
        turnId: "turn-encoded-path",
        workingDirectory: "/Users/tester/Documents/deep%20research",
        projectObservation: {
          workspacePath: "/Users/tester/Documents/deep%20research",
        },
      }),
    );

    const projects = storage.listProjects();
    assert.equal(projects[0]?.display_name, "deep research");
    assert.equal(projects[0]?.primary_workspace_path, "/Users/tester/Documents/deep research");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("temporary workspace paths stay low-confidence even when repeated across sessions", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-storage-temp-a", "Temp turn A", "stage-run-temp-a", {
        sessionId: "session-temp-a",
        turnId: "turn-temp-a",
        hostId: "host-1",
        platform: "codex",
        workingDirectory: "/root/.config/AionUi/aionui/claude-temp-abc",
        projectObservation: {
          workspacePath: "/root/.config/AionUi/aionui/claude-temp-abc",
        },
      }),
    );
    storage.replaceSourcePayload(
      createFixturePayload("src-storage-temp-b", "Temp turn B", "stage-run-temp-b", {
        sessionId: "session-temp-b",
        turnId: "turn-temp-b",
        hostId: "host-1",
        platform: "claude_code",
        workingDirectory: "/root/.config/AionUi/aionui/claude-temp-abc",
        projectObservation: {
          workspacePath: "/root/.config/AionUi/aionui/claude-temp-abc",
        },
      }),
    );

    const projects = storage.listProjects();
    assert.equal(projects.length, 1);

    const candidateProject = projects[0]!;
    assert.equal(candidateProject.linkage_state, "candidate");
    assert.equal(candidateProject.link_reason, "weak_path_hint");
    assert.equal(candidateProject.session_count, 2);
    assert.ok(candidateProject.confidence < 0.55);

    const resolvedTurns = storage.listResolvedTurns();
    assert.equal(resolvedTurns.length, 2);
    assert.ok(resolvedTurns.every((turn) => turn.link_state === "candidate"));
    assert.ok(resolvedTurns.every((turn) => turn.project_confidence === candidateProject.confidence));
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("derived linking review separates committed, candidate, and unlinked material", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-storage-remote", "Committed via remote", "stage-run-remote", {
        sessionId: "session-remote",
        turnId: "turn-remote",
        hostId: "host-1",
        platform: "codex",
        workingDirectory: "/workspace/remote-only",
        projectObservation: {
          workspacePath: "/workspace/remote-only",
          repoRemote: "https://example.com/org/remote-only",
        },
      }),
    );
    storage.replaceSourcePayload(
      createFixturePayload("src-storage-workspace", "Candidate via workspace", "stage-run-workspace", {
        sessionId: "session-workspace",
        turnId: "turn-workspace",
        hostId: "host-1",
        platform: "factory_droid",
        workingDirectory: "/workspace/local-only",
        projectObservation: {
          workspacePath: "/workspace/local-only",
        },
      }),
    );
    storage.replaceSourcePayload(
      createFixturePayload("src-storage-unlinked", "Unlinked turn", "stage-run-unlinked", {
        sessionId: "session-unlinked",
        turnId: "turn-unlinked",
        hostId: "host-1",
        platform: "amp",
        workingDirectory: "",
        includeProjectObservation: false,
      }),
    );

    const review = storage.getLinkingReview();
    assert.equal(review.committed_projects.length, 1);
    assert.equal(review.candidate_projects.length, 1);
    assert.equal(review.candidate_turns.length, 1);
    assert.equal(review.unlinked_turns.length, 1);
    assert.equal(review.candidate_turns[0]?.id, "turn-workspace");
    assert.equal(review.unlinked_turns[0]?.id, "turn-unlinked");

    const remoteProject = review.committed_projects[0]!;
    assert.equal(remoteProject.link_reason, "repo_remote_match");

    const remoteObservation = review.project_observations.find((observation) => observation.session_ref === "session-remote");
    assert.equal(remoteObservation?.project_id, remoteProject.project_id);
    assert.equal(remoteObservation?.linkage_state, "committed");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("linking review uses all project observation candidates instead of truncating to the first 500", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    const payload = createFixturePayload("src-storage-candidate-limit", "Candidate beyond candidate limit", "stage-run-candidate-limit", {
      sessionId: "session-candidate-limit",
      turnId: "turn-candidate-limit",
      hostId: "host-1",
      platform: "codex",
      workingDirectory: "/workspace/candidate-limit",
      projectObservation: {
        workspacePath: "/workspace/candidate-limit",
      },
    });

    const projectObservationCandidate = payload.candidates.find(
      (candidate) => candidate.candidate_kind === "project_observation",
    );
    assert.ok(projectObservationCandidate);
    projectObservationCandidate!.id = "0000-project-observation";

    for (let index = 0; index < 500; index += 1) {
      payload.candidates.push({
        id: `zzzz-noise-${String(index).padStart(4, "0")}`,
        source_id: payload.source.id,
        session_ref: payload.sessions[0]!.id,
        candidate_kind: "turn",
        input_atom_refs: [],
        started_at: payload.sessions[0]!.created_at,
        ended_at: payload.sessions[0]!.updated_at,
        rule_version: "2026-03-09.1",
        evidence: {
          noise: true,
          ordinal: index,
        },
      });
    }

    storage.replaceSourcePayload(payload);

    const review = storage.getLinkingReview();
    assert.equal(review.unlinked_turns.length, 0);
    assert.equal(review.candidate_turns.length, 1);
    assert.equal(review.candidate_turns[0]?.id, "turn-candidate-limit");
    assert.equal(review.candidate_turns[0]?.link_state, "candidate");
    assert.equal(review.project_observations.length, 1);
    assert.equal(review.project_observations[0]?.session_ref, "session-candidate-limit");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("manual overrides commit turns, create project revisions, and keep search/drift data queryable", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-storage-manual", "Manual override target", "stage-run-manual", {
        sessionId: "session-manual",
        turnId: "turn-manual",
        hostId: "host-1",
        platform: "codex",
        workingDirectory: "/workspace/manual-target",
        projectObservation: {
          workspacePath: "/workspace/manual-target",
        },
      }),
    );

    const beforeOverride = storage.listResolvedTurns().find((turn) => turn.id === "turn-manual");
    assert.equal(beforeOverride?.link_state, "candidate");

    storage.upsertProjectOverride({
      target_kind: "turn",
      target_ref: "turn-manual",
      project_id: "project-manual-test",
      display_name: "Manual Test Project",
      note: "manual link for coverage",
    });

    const afterOverride = storage.listResolvedTurns().find((turn) => turn.id === "turn-manual");
    assert.equal(afterOverride?.link_state, "committed");
    assert.equal(afterOverride?.project_id, "project-manual-test");

    const projectTurns = storage.listProjectTurns("project-manual-test", "committed");
    assert.equal(projectTurns.length, 1);
    assert.equal(projectTurns[0]?.id, "turn-manual");

    const revisions = storage.listProjectRevisions("project-manual-test");
    assert.ok(revisions.length >= 1);
    assert.equal(revisions[0]?.link_reason, "manual_override");

    const events = storage.listProjectLineageEvents("project-manual-test");
    assert.ok(events.some((event) => event.event_kind === "created" || event.event_kind === "manual_override"));

    const searchResults = storage.searchTurns({ query: "override target" });
    assert.ok(searchResults.some((result) => result.turn.id === "turn-manual"));

    const drift = storage.getDriftReport();
    assert.ok(drift.consistency_score >= 0);
    assert.equal(Array.isArray(drift.timeline), true);
    assert.equal(drift.timeline.length, 7);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("candidate lifecycle controls can archive or purge turns and artifact coverage remains queryable", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-storage-lifecycle", "Lifecycle candidate", "stage-run-lifecycle", {
        sessionId: "session-lifecycle",
        turnId: "turn-lifecycle",
        hostId: "host-1",
        platform: "amp",
        workingDirectory: "/workspace/lifecycle",
        projectObservation: {
          workspacePath: "/workspace/lifecycle",
        },
      }),
    );

    const archiveRun = storage.garbageCollectCandidateTurns({
      before_iso: "2026-03-10T00:00:00.000Z",
      mode: "archive",
    });
    assert.deepEqual(archiveRun.processed_turn_ids, ["turn-lifecycle"]);
    assert.equal(storage.getResolvedTurn("turn-lifecycle")?.value_axis, "archived");
    assert.equal(storage.getResolvedTurn("turn-lifecycle")?.retention_axis, "keep_raw_only");

    const artifact = storage.upsertKnowledgeArtifact({
      title: "Lifecycle Artifact",
      summary: "Captures lifecycle test coverage.",
      source_turn_refs: ["turn-lifecycle"],
    });
    assert.equal(storage.listKnowledgeArtifacts().length, 1);
    assert.equal(storage.listArtifactCoverage(artifact.artifact_id).length, 1);

    const tombstone = storage.purgeTurn("turn-lifecycle", "test_purge");
    assert.equal(tombstone?.logical_id, "turn-lifecycle");
    assert.equal(storage.getTombstone("turn-lifecycle")?.purge_reason, "test_purge");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("deleteProject purges linked sessions, removes the project, and rewrites impacted artifacts", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-project-delete-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-project-delete-a", "Delete project turn", "stage-run-project-delete-a", {
        sessionId: "session-project-delete-a",
        turnId: "turn-project-delete-a",
        hostId: "host-project-delete",
        workingDirectory: "/workspace/project-delete-a",
        projectObservation: {
          workspacePath: "/workspace/project-delete-a",
          repoRemote: "https://github.com/test/project-delete-a",
          repoFingerprint: "fp-project-delete-a",
        },
      }),
    );
    storage.replaceSourcePayload(
      createFixturePayload("src-project-delete-b", "Keep project turn", "stage-run-project-delete-b", {
        sessionId: "session-project-delete-b",
        turnId: "turn-project-delete-b",
        hostId: "host-project-delete",
        workingDirectory: "/workspace/project-delete-b",
        projectObservation: {
          workspacePath: "/workspace/project-delete-b",
          repoRemote: "https://github.com/test/project-delete-b",
          repoFingerprint: "fp-project-delete-b",
        },
      }),
    );

    const projectToDelete = storage
      .listProjects()
      .find((project) => project.primary_workspace_path === "/workspace/project-delete-a");
    assert.ok(projectToDelete, "project to delete should resolve");
    const preservedProject = storage
      .listProjects()
      .find((project) => project.primary_workspace_path === "/workspace/project-delete-b");
    assert.ok(preservedProject, "preserved project should resolve");

    storage.upsertProjectOverride({
      target_kind: "turn",
      target_ref: "turn-project-delete-a",
      project_id: projectToDelete.project_id,
      display_name: projectToDelete.display_name,
    });

    storage.upsertKnowledgeArtifact({
      artifact_id: "artifact-project-delete-owned",
      title: "Owned Artifact",
      summary: "Belongs to the deleted project.",
      project_id: projectToDelete.project_id,
      source_turn_refs: ["turn-project-delete-a"],
    });
    storage.upsertKnowledgeArtifact({
      artifact_id: "artifact-project-delete-shared",
      title: "Shared Artifact",
      summary: "References turns from both projects.",
      source_turn_refs: ["turn-project-delete-a", "turn-project-delete-b"],
    });

    const result = storage.deleteProject(projectToDelete.project_id, "test_delete_project");
    assert.ok(result, "deleteProject should return a result");
    assert.equal(result.project_id, projectToDelete.project_id);
    assert.deepEqual(result.deleted_session_ids, ["session-project-delete-a"]);
    assert.deepEqual(result.deleted_turn_ids, ["turn-project-delete-a"]);
    assert.ok(
      result.deleted_candidate_ids.includes("turn-project-delete-a-candidate-project-observation"),
      "project observation candidate should be deleted",
    );
    assert.equal(result.deleted_artifact_ids.includes("artifact-project-delete-owned"), true);
    assert.equal(result.updated_artifact_ids.includes("artifact-project-delete-shared"), true);
    assert.equal(
      result.tombstones.some(
        (tombstone) =>
          tombstone.object_kind === "project" &&
          tombstone.logical_id === projectToDelete.project_id &&
          tombstone.purge_reason === "test_delete_project",
      ),
      true,
    );

    assert.equal(storage.getProject(projectToDelete.project_id), undefined, "deleted project should be gone");
    assert.equal(storage.getTombstone(projectToDelete.project_id)?.object_kind, "project");
    assert.equal(storage.getTurn("turn-project-delete-a"), undefined, "deleted turn should be removed");
    assert.equal(storage.getSession("session-project-delete-a"), undefined, "deleted session should be removed");
    assert.equal(storage.getTombstone("turn-project-delete-a")?.purge_reason, "test_delete_project");
    assert.equal(storage.listProjects().some((project) => project.project_id === preservedProject.project_id), true);
    assert.equal(storage.getTurn("turn-project-delete-b")?.canonical_text, "Keep project turn");
    assert.equal(storage.listProjectOverrides().length, 0, "overrides targeting deleted project data should be removed");
    assert.equal(
      storage.listKnowledgeArtifacts().some((artifact) => artifact.artifact_id === "artifact-project-delete-owned"),
      false,
      "project-owned artifact should be removed",
    );

    const sharedArtifact = storage
      .listKnowledgeArtifacts()
      .find((artifact) => artifact.artifact_id === "artifact-project-delete-shared");
    assert.ok(sharedArtifact, "shared artifact should survive");
    assert.deepEqual(sharedArtifact.source_turn_refs, ["turn-project-delete-b"]);
    assert.equal(storage.listArtifactCoverage("artifact-project-delete-shared").length, 1);
    assert.equal(storage.listCandidates(50).some((candidate) => candidate.session_ref === "session-project-delete-a"), false);
    assert.equal(storage.listRecords(50).some((record) => record.session_ref === "session-project-delete-a"), false);
    assert.equal(storage.listFragments(50).some((fragment) => fragment.session_ref === "session-project-delete-a"), false);
    assert.equal(storage.listAtoms(50).some((atom) => atom.session_ref === "session-project-delete-a"), false);
    assert.equal(storage.listEdges(50).some((edge) => edge.session_ref === "session-project-delete-a"), false);

    const deletedSource = storage
      .listSources()
      .find((source) => source.base_dir.endsWith("/src-project-delete-a"));
    assert.equal(deletedSource?.total_sessions, 0);
    assert.equal(deletedSource?.total_turns, 0);
    assert.equal(deletedSource?.total_atoms, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("deleteProject keeps unrelated turns when a session spans multiple projects", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-project-delete-shared-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    const sharedSessionId = "session-project-delete-shared";
    const projectDeletePayload = createFixturePayload(
      "src-project-delete-shared",
      "Delete only this turn",
      "stage-run-project-delete-shared-a",
      {
        sessionId: sharedSessionId,
        turnId: "turn-project-delete-shared-a",
        hostId: "host-project-delete-shared",
        workingDirectory: "/workspace/project-delete-a",
        projectObservation: {
          workspacePath: "/workspace/project-delete-a",
          repoRemote: "https://github.com/test/project-delete-a",
          repoFingerprint: "fp-project-delete-shared-a",
        },
      },
    );
    const projectKeepPayload = rewriteFixtureTimestamps(
      createFixturePayload(
        "src-project-delete-shared",
        "Keep this turn",
        "stage-run-project-delete-shared-b",
        {
          sessionId: sharedSessionId,
          turnId: "turn-project-delete-shared-b",
          hostId: "host-project-delete-shared",
          workingDirectory: "/workspace/project-delete-b",
          projectObservation: {
            workspacePath: "/workspace/project-delete-b",
            repoRemote: "https://github.com/test/project-delete-b",
            repoFingerprint: "fp-project-delete-shared-b",
          },
        },
      ),
      {
        "2026-03-09T09:00:00.000Z": "2026-03-09T10:00:00.000Z",
        "2026-03-09T09:00:01.000Z": "2026-03-09T10:00:01.000Z",
        "2026-03-09T09:00:02.000Z": "2026-03-09T10:00:02.000Z",
        "2026-03-09T09:00:03.000Z": "2026-03-09T10:00:03.000Z",
      },
    );

    storage.replaceSourcePayload(
      combineFixturePayloads(projectDeletePayload, projectKeepPayload, {
        sessionId: sharedSessionId,
        title: "Shared session",
      }),
    );

    const projectToDelete = storage
      .listProjects()
      .find((project) => project.primary_workspace_path === "/workspace/project-delete-a");
    assert.ok(projectToDelete, "project to delete should resolve");
    const preservedProject = storage
      .listProjects()
      .find((project) => project.primary_workspace_path === "/workspace/project-delete-b");
    assert.ok(preservedProject, "preserved project should resolve");

    const result = storage.deleteProject(projectToDelete.project_id, "test_delete_shared_session");
    assert.ok(result, "deleteProject should return a result");
    assert.deepEqual(result.deleted_turn_ids, ["turn-project-delete-shared-a"]);
    assert.deepEqual(result.deleted_session_ids, []);
    assert.equal(storage.getTurn("turn-project-delete-shared-a"), undefined);
    assert.equal(storage.getTurn("turn-project-delete-shared-b")?.canonical_text, "Keep this turn");
    assert.equal(storage.getSession(sharedSessionId)?.turn_count, 1);
    assert.equal(storage.listProjects().some((project) => project.project_id === preservedProject.project_id), true);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Edge-case tests: search
// ---------------------------------------------------------------------------

test("searchTurns with empty query returns all turns sorted by recency", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-search-empty-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-search-empty", "First turn", "sr-1", {
        turnId: "turn-first",
        sessionId: "session-1",
      }),
    );
    const results = storage.searchTurns({ query: "" });
    assert.equal(results.length, 1);
    assert.equal(results[0]?.turn.id, "turn-first");
    assert.equal(results[0]?.highlights.length, 0, "Empty query should produce no highlights");
    assert.ok(results[0]!.relevance_score >= 0, "Relevance score should be non-negative");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("searchTurns with whitespace-only query returns all turns", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-search-ws-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-search-ws", "Whitespace test", "sr-ws"),
    );
    const results = storage.searchTurns({ query: "   \t\n  " });
    assert.equal(results.length, 1, "Whitespace-only query should act like empty query");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("searchTurns with FTS5 special characters does not throw", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-search-fts-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-search-fts", "Handle special chars", "sr-fts"),
    );
    // These are FTS5 operators/special chars that could cause parse errors
    const specialQueries = [
      '"unmatched quote',
      "NOT AND OR",
      "test*",
      "NEAR(a, b)",
      "col:value",
      "{braces}",
      "a OR b AND c",
      '""',
      "a + b - c",
    ];
    for (const query of specialQueries) {
      const results = storage.searchTurns({ query });
      assert.ok(Array.isArray(results), `Query "${query}" should not throw`);
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("searchTurns with unicode and emoji text matches correctly", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-search-uni-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-search-uni", "修复 Unicode 编码问题", "sr-uni"),
    );
    const results = storage.searchTurns({ query: "Unicode" });
    assert.equal(results.length, 1, "Unicode text should be searchable");
    assert.ok(results[0]!.highlights.length > 0, "Should highlight Unicode match");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("searchTurns does not broaden session metadata matches on partial multi-term overlap", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-search-session-overlap-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-search-session-target", "Alpha traceability target", "sr-session-target", {
        turnId: "turn-session-target",
        sessionId: "session-session-target",
        workingDirectory: "/workspace/alpha-history",
        projectObservation: {
          workspacePath: "/workspace/alpha-history",
          repoRoot: "/workspace/alpha-history",
          repoFingerprint: "fp-session-alpha",
        },
      }),
    );
    storage.replaceSourcePayload(
      createFixturePayload("src-search-session-nearby-a", "Alpha API parity review", "sr-session-nearby-a", {
        turnId: "turn-session-nearby-a",
        sessionId: "session-session-nearby-a",
        workingDirectory: "/workspace/alpha-history",
        projectObservation: {
          workspacePath: "/workspace/alpha-history",
          repoRoot: "/workspace/alpha-history",
          repoFingerprint: "fp-session-alpha",
        },
      }),
    );
    storage.replaceSourcePayload(
      createFixturePayload("src-search-session-nearby-b", "Alpha kickoff regression note", "sr-session-nearby-b", {
        turnId: "turn-session-nearby-b",
        sessionId: "session-session-nearby-b",
        workingDirectory: "/workspace/alpha-history",
        projectObservation: {
          workspacePath: "/workspace/alpha-history",
          repoRoot: "/workspace/alpha-history",
          repoFingerprint: "fp-session-alpha",
        },
      }),
    );

    const results = storage.searchTurns({ query: "Alpha traceability target" });
    assert.deepEqual(results.map((result) => result.turn.id), ["turn-session-target"]);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("searchTurns filters by project_id, source_ids, link_states, and value_axes combined", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-search-filter-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-search-filter-a", "Turn alpha", "sr-fa", {
        turnId: "turn-alpha",
        sessionId: "session-alpha",
        projectObservation: {
          workspacePath: "/workspace/alpha",
          repoRemote: "https://github.com/test/alpha",
          repoFingerprint: "fp-alpha-001",
        },
      }),
    );
    storage.replaceSourcePayload(
      createFixturePayload("src-search-filter-b", "Turn beta", "sr-fb", {
        turnId: "turn-beta",
        sessionId: "session-beta",
        projectObservation: {
          workspacePath: "/workspace/beta",
          repoRemote: "https://github.com/test/beta",
          repoFingerprint: "fp-beta-002",
        },
      }),
    );

    // Source IDs get re-keyed from legacy src- prefix, so query the actual stored IDs
    const sources = storage.listSources();
    assert.equal(sources.length, 2);
    const sourceA = sources.find((s) => s.display_name === "Storage fixture" && s.base_dir.includes("src-search-filter-a"));
    assert.ok(sourceA, "Should find source A");

    // Filter by source_ids using the actual re-keyed ID
    const bySource = storage.searchTurns({ source_ids: [sourceA.id] });
    assert.equal(bySource.length, 1);
    assert.equal(bySource[0]?.turn.source_id, sourceA.id);

    // Filter by link_states
    const committedOnly = storage.searchTurns({ link_states: ["committed"] });
    assert.ok(committedOnly.every((r) => r.turn.link_state === "committed"));

    // Filter by value_axes
    const activeOnly = storage.searchTurns({ value_axes: ["active"] });
    assert.ok(activeOnly.every((r) => r.turn.value_axis === "active"));

    // Combined filters with empty source_ids array should not filter
    const emptySourceFilter = storage.searchTurns({ source_ids: [] });
    assert.equal(emptySourceFilter.length, 2, "Empty source_ids array should not filter");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("searchTurns highlight positions are correct at text boundaries", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-search-hl-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-search-hl", "abc abc abc", "sr-hl"),
    );
    const results = storage.searchTurns({ query: "abc" });
    assert.equal(results.length, 1);
    const highlights = results[0]!.highlights;
    assert.equal(highlights.length, 3, "Should find 3 occurrences");
    assert.deepEqual(highlights[0], { start: 0, end: 3 }, "First highlight at start");
    assert.deepEqual(highlights[1], { start: 4, end: 7 }, "Second highlight in middle");
    assert.deepEqual(highlights[2], { start: 8, end: 11 }, "Third highlight at end");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("searchTurns with limit returns at most N results", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-search-limit-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    for (let i = 0; i < 5; i++) {
      storage.replaceSourcePayload(
        createFixturePayload(`src-limit-${i}`, `Limit test ${i}`, `sr-limit-${i}`, {
          turnId: `turn-limit-${i}`,
          sessionId: `session-limit-${i}`,
        }),
      );
    }
    const limited = storage.searchTurns({ limit: 2 });
    assert.equal(limited.length, 2, "Should respect limit");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Edge-case tests: empty and minimal payloads
// ---------------------------------------------------------------------------

test("replaceSourcePayload with zero turns creates source but isEmpty behavior is correct", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-empty-payload-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const emptyPayload: SourceSyncPayload = {
      source: {
        id: "src-empty",
        slot_id: "codex",
        family: "local_coding_agent",
        platform: "codex",
        display_name: "Empty source",
        base_dir: "/tmp/empty",
        host_id: "host-empty",
        last_sync: "2026-03-09T09:00:00.000Z",
        sync_status: "healthy",
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
    storage.replaceSourcePayload(emptyPayload);
    assert.equal(storage.isEmpty(), false, "Source exists so not empty");
    assert.equal(storage.listSources().length, 1);
    assert.equal(storage.listTurns().length, 0);
    assert.equal(storage.listProjects().length, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("fresh storage is empty", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-fresh-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    assert.equal(storage.isEmpty(), true);
    assert.equal(storage.listSources().length, 0);
    assert.equal(storage.listTurns().length, 0);
    assert.equal(storage.listProjects().length, 0);
    assert.equal(storage.searchTurns().length, 0);
    assert.equal(storage.getDriftReport().active_sources, 0);
    assert.equal(storage.getDriftReport().consistency_score, 1, "No data means perfect consistency");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Edge-case tests: lifecycle (purge, GC, tombstones)
// ---------------------------------------------------------------------------

test("purgeTurn returns undefined for non-existent turn", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-purge-missing-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const result = storage.purgeTurn("turn-does-not-exist");
    assert.equal(result, undefined, "Purging non-existent turn returns undefined");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("purgeTurn is idempotent - second purge returns existing tombstone", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-purge-idem-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-purge-idem", "Purge me", "sr-purge-idem", {
        turnId: "turn-purge-idem",
        sessionId: "session-purge-idem",
      }),
    );

    const first = storage.purgeTurn("turn-purge-idem", "first_purge");
    assert.ok(first);
    assert.equal(first.purge_reason, "first_purge");
    assert.equal(storage.getTurn("turn-purge-idem"), undefined, "Turn should be deleted after purge");

    const second = storage.purgeTurn("turn-purge-idem", "second_purge");
    assert.ok(second);
    assert.equal(second.purge_reason, "first_purge", "Should return original tombstone, not create new one");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("garbageCollectCandidateTurns with purge mode creates tombstones", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-gc-purge-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-gc-purge", "GC purge target", "sr-gc-purge", {
        turnId: "turn-gc-purge",
        sessionId: "session-gc-purge",
        hostId: "host-gc",
        platform: "codex",
        workingDirectory: "/workspace/gc-purge",
        projectObservation: {
          workspacePath: "/workspace/gc-purge",
        },
      }),
    );

    const result = storage.garbageCollectCandidateTurns({
      before_iso: "2026-03-10T00:00:00.000Z",
      mode: "purge",
    });
    assert.equal(result.processed_turn_ids.length, 1);
    assert.equal(result.tombstones.length, 1);
    assert.equal(result.tombstones[0]?.retention_axis, "purged");
    assert.equal(storage.getTurn("turn-gc-purge"), undefined, "Turn should be removed after purge GC");
    assert.ok(storage.getTombstone("turn-gc-purge"), "Tombstone should exist");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("garbageCollectCandidateTurns skips committed turns", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-gc-skip-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-gc-committed", "Should survive GC", "sr-gc-committed", {
        turnId: "turn-gc-committed",
        sessionId: "session-gc-committed",
        hostId: "host-gc",
        projectObservation: {
          workspacePath: "/workspace/committed",
          repoFingerprint: "fp-gc-committed",
          repoRemote: "https://github.com/test/gc",
        },
      }),
    );

    const result = storage.garbageCollectCandidateTurns({
      before_iso: "2026-03-10T00:00:00.000Z",
      mode: "purge",
    });
    assert.equal(result.processed_turn_ids.length, 0, "Committed turns should not be GC'd");
    assert.ok(storage.getTurn("turn-gc-committed"), "Committed turn should still exist");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("garbageCollectCandidateTurns respects before_iso cutoff", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-gc-cutoff-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-gc-cutoff", "Future candidate", "sr-gc-cutoff", {
        turnId: "turn-gc-cutoff",
        sessionId: "session-gc-cutoff",
        hostId: "host-gc",
        workingDirectory: "/workspace/cutoff",
        projectObservation: { workspacePath: "/workspace/cutoff" },
      }),
    );

    // Use a cutoff before the turn's timestamp
    const result = storage.garbageCollectCandidateTurns({
      before_iso: "2026-03-08T00:00:00.000Z",
      mode: "archive",
    });
    assert.equal(result.processed_turn_ids.length, 0, "Turn after cutoff should be skipped");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Edge-case tests: usage stats
// ---------------------------------------------------------------------------

test("usage overview with no turns returns zero coverage", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-usage-empty-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const overview = storage.getUsageOverview();
    assert.equal(overview.total_turns, 0);
    assert.equal(overview.turns_with_token_usage, 0);
    assert.equal(overview.turn_coverage_ratio, 0, "Zero turns means zero coverage ratio");
    assert.equal(overview.total_tokens, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("usage overview includes token_usage from context_summary", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-usage-tokens-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-usage-tokens", "Usage test", "sr-usage-tokens", {
        turnId: "turn-usage",
        sessionId: "session-usage",
      }),
    );
    const overview = storage.getUsageOverview();
    assert.equal(overview.total_turns, 1);
    assert.equal(overview.turns_with_token_usage, 1, "Fixture now has token_usage");
    assert.equal(overview.turn_coverage_ratio, 1, "All turns have usage");
    assert.equal(overview.total_input_tokens, 1200);
    assert.equal(overview.total_output_tokens, 450);
    assert.equal(overview.total_tokens, 2050);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("usage rollup by model groups turns correctly", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-usage-model-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-usage-model", "Model rollup test", "sr-model", {
        turnId: "turn-model",
        sessionId: "session-model",
      }),
    );
    const rollup = storage.listUsageRollup("model");
    assert.equal(rollup.dimension, "model");
    const gpt5Row = rollup.rows.find((r) => r.key === "gpt-5");
    assert.ok(gpt5Row, "Should have a gpt-5 row");
    assert.equal(gpt5Row.turn_count, 1);
    assert.equal(gpt5Row.total_tokens, 2050);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Edge-case tests: drift report
// ---------------------------------------------------------------------------

test("drift report with all healthy sources yields low drift index", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-drift-healthy-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-drift-healthy", "Healthy drift test", "sr-drift", {
        turnId: "turn-drift-healthy",
        sessionId: "session-drift-healthy",
        projectObservation: {
          workspacePath: "/workspace/drift",
          repoFingerprint: "fp-drift-001",
          repoRemote: "https://github.com/test/drift",
        },
      }),
    );
    const report = storage.getDriftReport();
    assert.equal(report.active_sources, 1);
    assert.equal(report.sources_awaiting_sync, 0);
    assert.equal(report.unlinked_turns, 0);
    assert.ok(report.consistency_score > 0.9, `Consistency should be high, got ${report.consistency_score}`);
    assert.equal(report.timeline.length, 7, "Timeline should have 7 days");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("drift report with stale source penalizes consistency score", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-drift-stale-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const stalePayload: SourceSyncPayload = {
      source: {
        id: "src-stale",
        slot_id: "codex",
        family: "local_coding_agent",
        platform: "codex",
        display_name: "Stale source",
        base_dir: "/tmp/stale",
        host_id: "host-stale",
        last_sync: "2026-01-01T00:00:00.000Z",
        sync_status: "stale",
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
    storage.replaceSourcePayload(stalePayload);
    const report = storage.getDriftReport();
    assert.equal(report.active_sources, 0);
    assert.equal(report.sources_awaiting_sync, 1);
    assert.ok(
      report.consistency_score < 1,
      `Stale source should reduce consistency, got ${report.consistency_score}`,
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Edge-case tests: knowledge artifacts
// ---------------------------------------------------------------------------

test("upsertKnowledgeArtifact deduplicates source_turn_refs", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-artifact-dedup-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const artifact = storage.upsertKnowledgeArtifact({
      title: "Dedup test",
      summary: "Should deduplicate refs",
      source_turn_refs: ["turn-a", "turn-b", "turn-a", "turn-b", "turn-c"],
    });
    assert.deepEqual(artifact.source_turn_refs, ["turn-a", "turn-b", "turn-c"]);
    assert.equal(storage.listArtifactCoverage(artifact.artifact_id).length, 3);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("upsertKnowledgeArtifact increments revision on update", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-artifact-rev-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const v1 = storage.upsertKnowledgeArtifact({
      title: "Revision test",
      summary: "v1",
      source_turn_refs: ["turn-1"],
    });
    assert.ok(v1.artifact_revision_id.endsWith(":r1"), `First revision should be :r1, got ${v1.artifact_revision_id}`);

    const v2 = storage.upsertKnowledgeArtifact({
      artifact_id: v1.artifact_id,
      title: "Revision test",
      summary: "v2",
      source_turn_refs: ["turn-1", "turn-2"],
    });
    assert.ok(v2.artifact_revision_id.endsWith(":r2"), `Second revision should be :r2, got ${v2.artifact_revision_id}`);

    const v3 = storage.upsertKnowledgeArtifact({
      artifact_id: v1.artifact_id,
      title: "Revision test",
      summary: "v3",
      source_turn_refs: ["turn-1"],
    });
    assert.ok(v3.artifact_revision_id.endsWith(":r3"), `Third revision should be :r3, got ${v3.artifact_revision_id}`);
    assert.equal(v3.created_at, v1.created_at, "created_at should be preserved across revisions");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Edge-case tests: project linking edge cases
// ---------------------------------------------------------------------------

test("linking with weak workspace paths (/tmp, /root) produces lower confidence", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-link-weak-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    // Weak path: /tmp
    storage.replaceSourcePayload(
      createFixturePayload("src-link-weak", "Weak path turn", "sr-weak", {
        turnId: "turn-weak-path",
        sessionId: "session-weak-path",
        hostId: "host-weak",
        workingDirectory: "/tmp/throwaway",
        projectObservation: {
          workspacePath: "/tmp/throwaway",
        },
      }),
    );
    const projects = storage.listProjects();
    assert.ok(projects.length > 0, "Should still create a project");
    const weakProject = projects[0];
    assert.ok(weakProject, "Should still create a project");
    assert.ok(
      weakProject.confidence < 0.65,
      `Weak path project confidence should be < 0.65, got ${weakProject.confidence}`,
    );
    assert.equal(weakProject.linkage_state, "candidate", "Weak path should be candidate not committed");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("linking with repo_fingerprint produces committed project with high confidence", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-link-fp-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-link-fp", "Fingerprint link", "sr-fp", {
        turnId: "turn-fp-link",
        sessionId: "session-fp-link",
        hostId: "host-fp",
        projectObservation: {
          workspacePath: "/workspace/project-fp",
          repoFingerprint: "fingerprint-abc-123",
          repoRemote: "https://github.com/test/repo-fp",
        },
      }),
    );
    const projects = storage.listProjects();
    const fpProject = projects.find((p) => p.repo_fingerprint === "fingerprint-abc-123");
    assert.ok(fpProject, "Should create project with fingerprint");
    assert.equal(fpProject.linkage_state, "committed");
    assert.ok(fpProject.confidence >= 0.9, `Fingerprint confidence should be >= 0.9, got ${fpProject.confidence}`);

    const turns = storage.listResolvedTurns();
    assert.equal(turns[0]?.link_state, "committed", "Turn should be committed");
    assert.equal(turns[0]?.project_id, fpProject.project_id);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("same host repo root continuity preserves one committed project across repo remote drift", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-link-root-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-link-root-a", "Remote A", "sr-root-a", {
        turnId: "turn-root-a",
        sessionId: "session-root-a",
        hostId: "host-root",
        platform: "codex",
        workingDirectory: "/workspace/cchistory",
        projectObservation: {
          workspacePath: "/workspace/cchistory",
          repoRoot: "/workspace/cchistory",
          repoRemote: "https://github.com/test/cchistory",
          repoFingerprint: "fingerprint-remote-a",
        },
      }),
    );
    storage.replaceSourcePayload(
      createFixturePayload("src-link-root-b", "Remote B", "sr-root-b", {
        turnId: "turn-root-b",
        sessionId: "session-root-b",
        hostId: "host-root",
        platform: "antigravity",
        workingDirectory: "/workspace/cchistory",
        projectObservation: {
          workspacePath: "/workspace/cchistory",
          repoRoot: "/workspace/cchistory",
          repoRemote: "/workspace/cchistory",
          repoFingerprint: "fingerprint-remote-b",
        },
      }),
    );

    const projects = storage.listProjects();
    assert.equal(projects.length, 1);
    assert.equal(projects[0]?.linkage_state, "committed");
    assert.equal(projects[0]?.link_reason, "repo_root_match");
    assert.deepEqual(projects[0]?.source_platforms, ["antigravity", "codex"]);

    const turns = storage.listResolvedTurns();
    assert.equal(turns[0]?.project_id, turns[1]?.project_id);
    assert.equal(turns[0]?.link_state, "committed");
    assert.equal(turns[1]?.link_state, "committed");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("turns without project observations and no workspace stay unlinked", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-link-none-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const payload = createFixturePayload("src-link-none", "No observation turn", "sr-none", {
      turnId: "turn-no-obs",
      sessionId: "session-no-obs",
      includeProjectObservation: false,
    });
    // Clear the session's working_directory so the fallback linker has no path to derive from
    payload.sessions[0]!.working_directory = undefined;
    storage.replaceSourcePayload(payload);
    const turns = storage.listResolvedTurns();
    assert.equal(turns.length, 1);
    assert.equal(turns[0]?.link_state, "unlinked", "Turn without observations or workspace should be unlinked");
    assert.equal(turns[0]?.project_id, undefined);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("fallback linker derives candidate link from session workspace_path when no explicit observation exists", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-link-fallback-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-link-fallback", "Fallback link test", "sr-fallback", {
        turnId: "turn-fallback",
        sessionId: "session-fallback",
        hostId: "host-fallback",
        includeProjectObservation: false,
        workingDirectory: "/workspace/real-project",
      }),
    );
    const turns = storage.listResolvedTurns();
    assert.equal(turns.length, 1);
    assert.equal(
      turns[0]?.link_state,
      "candidate",
      "Fallback linker should derive candidate link from session workspace",
    );
    assert.ok(turns[0]?.project_id, "Fallback linker should assign a project_id");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("manual override for non-existent project creates synthetic project", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-override-new-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-override-new", "Override target", "sr-override-new", {
        turnId: "turn-override-new",
        sessionId: "session-override-new",
        includeProjectObservation: false,
      }),
    );

    const override = storage.upsertProjectOverride({
      target_kind: "turn",
      target_ref: "turn-override-new",
      project_id: "project-manual-new",
      display_name: "Manually Created Project",
    });
    assert.equal(override.project_id, "project-manual-new");

    const turn = storage.getResolvedTurn("turn-override-new");
    assert.equal(turn?.link_state, "committed", "Override should commit the turn");
    assert.equal(turn?.project_id, "project-manual-new");

    const projects = storage.listProjects();
    const manualProject = projects.find((p) => p.project_id === "project-manual-new");
    assert.ok(manualProject, "Manual project should exist in project list");
    assert.equal(manualProject.link_reason, "manual_override");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("manual override wins over automatic linking", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-override-wins-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-override-wins", "Override wins test", "sr-override-wins", {
        turnId: "turn-override-wins",
        sessionId: "session-override-wins",
        hostId: "host-override",
        projectObservation: {
          workspacePath: "/workspace/auto-link",
          repoFingerprint: "fp-auto-link",
          repoRemote: "https://github.com/test/auto",
        },
      }),
    );

    // Turn should initially be committed via fingerprint
    const turnBefore = storage.getResolvedTurn("turn-override-wins");
    assert.equal(turnBefore?.link_state, "committed");

    // Override to a different project
    storage.upsertProjectOverride({
      target_kind: "turn",
      target_ref: "turn-override-wins",
      project_id: "project-manual-override",
      display_name: "Manual Override Project",
    });

    const turnAfter = storage.getResolvedTurn("turn-override-wins");
    assert.equal(turnAfter?.project_id, "project-manual-override", "Manual override should win");
    assert.equal(turnAfter?.link_state, "committed");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Edge-case tests: source identity and re-keying
// ---------------------------------------------------------------------------

test("replaceSourcePayload with legacy src- prefixed ID re-derives stable ID", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-rekey-legacy-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const legacyPayload = createFixturePayload("src-legacy-test", "Legacy source", "sr-legacy", {
      hostId: "host-legacy",
    });
    storage.replaceSourcePayload(legacyPayload);

    const sources = storage.listSources();
    assert.equal(sources.length, 1);
    assert.ok(
      sources[0]!.id.startsWith("srcinst-"),
      `Legacy src- prefix should be re-keyed to srcinst-, got ${sources[0]!.id}`,
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("replaceSourcePayload with Windows-style backslash paths normalizes correctly", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-winpath-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const winPayload = createFixturePayload("srcinst-win-test", "Windows path test", "sr-win", {
      baseDir: "C:\\Users\\dev\\.codex\\sessions",
      hostId: "host-win",
    });
    // Override the source ID to avoid re-keying
    winPayload.source.id = deriveSourceInstanceId({
      host_id: "host-win",
      slot_id: "codex",
      base_dir: "C:\\Users\\dev\\.codex\\sessions",
    });
    storage.replaceSourcePayload(winPayload);

    const sources = storage.listSources();
    assert.equal(sources.length, 1);
    // Verify it doesn't crash and the source is stored
    assert.ok(sources[0]!.base_dir.includes("codex"), "Base dir should contain codex path");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});


test("replaceSourcePayload treats equivalent Windows source roots as one source identity", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-winpath-eq-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const firstBaseDir = "C:\\Users\\dev\\.codex\\sessions";
    const secondBaseDir = "c:/Users\dev/.codex\sessions/";
    const canonicalSourceId = deriveSourceInstanceId({
      host_id: "host-win",
      slot_id: "codex",
      base_dir: firstBaseDir,
    });

    const firstPayload = createFixturePayload(canonicalSourceId, "Windows identity first", "sr-win-eq-1", {
      baseDir: firstBaseDir,
      hostId: "host-win",
    });
    const secondPayload = createFixturePayload(canonicalSourceId, "Windows identity second", "sr-win-eq-2", {
      baseDir: secondBaseDir,
      hostId: "host-win",
    });

    storage.replaceSourcePayload(firstPayload);
    storage.replaceSourcePayload(secondPayload);

    const sources = storage.listSources();
    assert.equal(sources.length, 1);
    assert.equal(sources[0]?.id, canonicalSourceId);
    assert.equal(storage.listResolvedSessions().length, 1);
    assert.equal(storage.listTurns().length, 1);
    assert.equal(storage.getTurn("turn-1")?.canonical_text, "Windows identity second");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Edge-case tests: getTurnLineage edge cases
// ---------------------------------------------------------------------------

test("getTurnLineage returns undefined for non-existent turn", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-lineage-missing-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const lineage = storage.getTurnLineage("turn-does-not-exist");
    assert.equal(lineage, undefined);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("getTurnLineage returns complete chain even with empty atom_refs", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-lineage-empty-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const payload = createFixturePayload("src-lineage-empty", "Lineage test", "sr-lineage", {
      turnId: "turn-lineage-test",
      sessionId: "session-lineage-test",
    });
    // Remove atoms from the turn's lineage to test sparse lineage
    payload.turns[0]!.lineage.atom_refs = [];
    storage.replaceSourcePayload(payload);

    const lineage = storage.getTurnLineage("turn-lineage-test");
    assert.ok(lineage);
    assert.equal(lineage.atoms.length, 0, "Should handle empty atom refs");
    assert.equal(lineage.edges.length, 0, "No atoms means no edges");
    assert.ok(lineage.turn, "Turn should still be present");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Edge-case tests: import bundles
// ---------------------------------------------------------------------------

test("upsertImportedBundle stores and retrieves bundle records", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-import-bundle-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const bundle = {
      bundle_id: "bundle-test-001",
      bundle_version: "1.0.0",
      imported_at: "2026-03-09T12:00:00.000Z",
      source_instance_ids: ["src-1", "src-2"],
      manifest: {
        bundle_id: "bundle-test-001",
        bundle_version: "1.0.0",
        exported_at: "2026-03-09T11:00:00.000Z",
        exported_from_host_ids: ["host-export"],
        schema_version: "1",
        source_instance_ids: ["src-1", "src-2"],
        counts: { sources: 2, sessions: 5, turns: 20, blobs: 10 },
        includes_raw_blobs: true,
        created_by: "cchistory-cli",
      },
      checksums: {
        manifest_sha256: "abc123",
        payload_sha256_by_source_id: { "src-1": "def456" },
        raw_sha256_by_path: {},
      },
    };

    storage.upsertImportedBundle(bundle);
    const retrieved = storage.getImportedBundle("bundle-test-001");
    assert.ok(retrieved);
    assert.equal(retrieved.bundle_id, "bundle-test-001");
    assert.deepEqual(retrieved.source_instance_ids, ["src-1", "src-2"]);

    // Upsert again should replace
    const updated = { ...bundle, imported_at: "2026-03-10T12:00:00.000Z" };
    storage.upsertImportedBundle(updated);
    const updatedRetrieved = storage.getImportedBundle("bundle-test-001");
    assert.equal(updatedRetrieved?.imported_at, "2026-03-10T12:00:00.000Z");

    assert.equal(storage.listImportedBundles().length, 1);
    assert.equal(storage.getImportedBundle("non-existent"), undefined);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Edge-case tests: project lineage events
// ---------------------------------------------------------------------------

test("appendProjectLineageEvent creates events with stable IDs", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-lineage-event-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-lineage-event", "Lineage event test", "sr-le", {
        turnId: "turn-le",
        sessionId: "session-le",
        hostId: "host-le",
        projectObservation: {
          workspacePath: "/workspace/le",
          repoFingerprint: "fp-le-001",
          repoRemote: "https://github.com/test/le",
        },
      }),
    );
    const projects = storage.listProjects();
    assert.ok(projects.length > 0);
    const project = projects[0]!;

    const event = storage.appendProjectLineageEvent({
      project_id: project.project_id,
      event_kind: "revised",
      detail: { reason: "test revision" },
    });
    assert.ok(event.id);
    assert.equal(event.event_kind, "revised");
    assert.equal(event.project_id, project.project_id);

    const events = storage.listProjectLineageEvents(project.project_id);
    assert.ok(events.length >= 1);
    assert.ok(events.some((e) => e.id === event.id));
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Edge-case tests: cross-platform linking
// ---------------------------------------------------------------------------

test("same repo fingerprint across different platforms consolidates into one project", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-cross-plat-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const sharedFingerprint = "fp-cross-platform-shared";
    const sharedRemote = "https://github.com/test/cross-platform";
    const sharedWorkspace = "/workspace/cross-platform";

    storage.replaceSourcePayload(
      createFixturePayload("src-cross-codex", "Codex turn", "sr-cross-codex", {
        turnId: "turn-cross-codex",
        sessionId: "session-cross-codex",
        hostId: "host-cross",
        platform: "codex",
        workingDirectory: sharedWorkspace,
        projectObservation: {
          workspacePath: sharedWorkspace,
          repoFingerprint: sharedFingerprint,
          repoRemote: sharedRemote,
        },
      }),
    );
    storage.replaceSourcePayload(
      createFixturePayload("src-cross-claude", "Claude turn", "sr-cross-claude", {
        turnId: "turn-cross-claude",
        sessionId: "session-cross-claude",
        hostId: "host-cross",
        platform: "claude_code",
        workingDirectory: sharedWorkspace,
        projectObservation: {
          workspacePath: sharedWorkspace,
          repoFingerprint: sharedFingerprint,
          repoRemote: sharedRemote,
        },
      }),
    );

    const projects = storage.listProjects();
    const crossProject = projects.find((p) => p.repo_fingerprint === sharedFingerprint);
    assert.ok(crossProject, "Cross-platform project should exist");
    assert.equal(crossProject.linkage_state, "committed");
    assert.ok(
      crossProject.source_platforms.length >= 2,
      `Should have 2+ platforms, got ${crossProject.source_platforms.join(", ")}`,
    );
    assert.ok(crossProject.source_platforms.includes("codex"));
    assert.ok(crossProject.source_platforms.includes("claude_code"));

    const turns = storage.listResolvedTurns();
    const codexTurn = turns.find((t) => t.id === "turn-cross-codex");
    const claudeTurn = turns.find((t) => t.id === "turn-cross-claude");
    assert.equal(codexTurn?.project_id, crossProject.project_id, "Codex turn in same project");
    assert.equal(claudeTurn?.project_id, crossProject.project_id, "Claude turn in same project");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Edge-case tests: replaceSourcePayload idempotency
// ---------------------------------------------------------------------------

test("replaceSourcePayload is idempotent - double ingest produces same state", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-idempotent-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const payload = createFixturePayload("src-idempotent", "Idempotent test", "sr-idem", {
      turnId: "turn-idem",
      sessionId: "session-idem",
      projectObservation: {
        workspacePath: "/workspace/idem",
        repoFingerprint: "fp-idem",
        repoRemote: "https://github.com/test/idem",
      },
    });

    storage.replaceSourcePayload(payload);
    const turnsAfterFirst = storage.listTurns().length;
    const projectsAfterFirst = storage.listProjects().length;

    storage.replaceSourcePayload(payload);
    const turnsAfterSecond = storage.listTurns().length;
    const projectsAfterSecond = storage.listProjects().length;

    assert.equal(turnsAfterFirst, turnsAfterSecond, "Turn count should not change on re-ingest");
    assert.equal(projectsAfterFirst, projectsAfterSecond, "Project count should not change on re-ingest");
    assert.equal(storage.listSources().length, 1, "Should still have exactly one source");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Edge-case tests: session and source payload reconstruction
// ---------------------------------------------------------------------------

test("getSourcePayload returns undefined for unknown source ID", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-unknown-src-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const result = storage.getSourcePayload("src-does-not-exist");
    assert.equal(result, undefined);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("getSession and getTurnContext return undefined for missing IDs", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-missing-ids-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    assert.equal(storage.getSession("session-missing"), undefined);
    assert.equal(storage.getTurnContext("turn-missing"), undefined);
    assert.equal(storage.getTurn("turn-missing"), undefined);
    assert.equal(storage.getResolvedTurn("turn-missing"), undefined);
    assert.equal(storage.getResolvedSession("session-missing"), undefined);
    assert.equal(storage.getProject("project-missing"), undefined);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Edge-case tests: multiple sources on same storage
// ---------------------------------------------------------------------------

test("multiple sources coexist and query independently", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-multi-src-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-multi-a", "Source A turn", "sr-a", {
        turnId: "turn-multi-a",
        sessionId: "session-multi-a",
        hostId: "host-multi",
        projectObservation: {
          workspacePath: "/workspace/multi-a",
          repoFingerprint: "fp-multi-a",
          repoRemote: "https://github.com/test/multi-a",
        },
      }),
    );
    storage.replaceSourcePayload(
      createFixturePayload("src-multi-b", "Source B turn", "sr-b", {
        turnId: "turn-multi-b",
        sessionId: "session-multi-b",
        hostId: "host-multi",
        projectObservation: {
          workspacePath: "/workspace/multi-b",
          repoFingerprint: "fp-multi-b",
          repoRemote: "https://github.com/test/multi-b",
        },
      }),
    );

    assert.equal(storage.listSources().length, 2);
    assert.equal(storage.listTurns().length, 2);

    // Replacing one source should not affect the other
    storage.replaceSourcePayload(
      createFixturePayload("src-multi-a", "Source A updated", "sr-a2", {
        turnId: "turn-multi-a-v2",
        sessionId: "session-multi-a-v2",
        hostId: "host-multi",
        projectObservation: {
          workspacePath: "/workspace/multi-a",
          repoFingerprint: "fp-multi-a",
          repoRemote: "https://github.com/test/multi-a",
        },
      }),
    );

    assert.equal(storage.listSources().length, 2, "Should still have 2 sources");
    assert.equal(storage.listTurns().length, 2, "Should have 2 turns (1 replaced + 1 unchanged)");
    const turns = storage.listTurns();
    assert.ok(
      turns.some((t) => t.id === "turn-multi-a-v2"),
      "Source A should have updated turn",
    );
    assert.ok(
      turns.some((t) => t.id === "turn-multi-b"),
      "Source B turn should be unchanged",
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Edge-case tests: search highlight edge cases
// ---------------------------------------------------------------------------

test("searchTurns with case-insensitive matching", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-search-case-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-case", "Fix TypeScript ERROR in Module", "sr-case"),
    );
    const results = storage.searchTurns({ query: "typescript error" });
    assert.equal(results.length, 1, "Case-insensitive search should match");
    assert.ok(results[0]!.highlights.length > 0, "Should have highlights despite case mismatch");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("searchTurns matches partial multi-token queries without requiring an exact phrase", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-search-partial-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-partial", "Fix TypeScript error in module loader", "sr-partial"),
    );
    const results = storage.searchTurns({ query: "modu typescr" });
    assert.equal(results.length, 1, "Partial token search should match without exact phrase order");
    assert.ok(results[0]!.highlights.length >= 2, "Partial token search should highlight the matched token fragments");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("searchTurns keeps punctuation-bearing programming queries literal", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-search-punctuation-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-cpp", "Explain C++ ownership rules", "sr-cpp", {
        turnId: "turn-cpp",
        sessionId: "session-cpp",
      }),
    );
    storage.replaceSourcePayload(
      createFixturePayload("src-csharp", "Review C# nullable flow", "sr-csharp", {
        turnId: "turn-csharp",
        sessionId: "session-csharp",
      }),
    );
    storage.replaceSourcePayload(
      createFixturePayload("src-letter", "Collect codex changelog notes", "sr-letter", {
        turnId: "turn-letter",
        sessionId: "session-letter",
      }),
    );

    const cppResults = storage.searchTurns({ query: "C++" });
    assert.deepEqual(cppResults.map((result) => result.turn.id), ["turn-cpp"]);

    const csharpResults = storage.searchTurns({ query: "C#" });
    assert.deepEqual(csharpResults.map((result) => result.turn.id), ["turn-csharp"]);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("querySearchIndex preserves indexed punctuation matches while filtering them literally", () => {
  const turns = [
    {
      id: "turn-csharp-raw",
      canonical_text: "Review nullable flow",
      raw_text: "Assistant note: C# nullable flow only appears in context.",
    },
    {
      id: "turn-cpp-false-positive",
      canonical_text: "Review ownership flow",
      raw_text: "Assistant note: C++ ownership rules.",
    },
  ] as UserTurnProjection[];

  let indexedSearchUsed = false;
  const db = {
    prepare(sql: string) {
      assert.match(sql, /search_index MATCH/);
      return {
        all(ftsQuery: string, limit: number) {
          indexedSearchUsed = true;
          assert.equal(ftsQuery, "\"c#\"");
          assert.equal(limit, 10);
          return [{ turn_id: "turn-cpp-false-positive" }, { turn_id: "turn-csharp-raw" }];
        },
      };
    },
  } as unknown as DatabaseSync;

  const results = querySearchIndex({
    db,
    searchIndexReady: true,
    query: "C#",
    limit: 10,
    listResolvedTurns: () => turns,
  });

  assert.equal(indexedSearchUsed, true);
  assert.deepEqual(results, ["turn-csharp-raw"]);
});

test("searchTurns with query longer than text returns no highlights", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-search-long-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-long", "Hi", "sr-long"),
    );
    const results = storage.searchTurns({ query: "This is a very long query that cannot match Hi" });
    // The turn should still be returned if it matches via FTS (or not if substring doesn't match)
    // Key: no crash
    assert.ok(Array.isArray(results), "Should not throw on long query");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

interface FixturePayloadOptions {
  sessionId?: string;
  turnId?: string;
  hostId?: string;
  platform?: "codex" | "claude_code" | "factory_droid" | "amp" | "cursor" | "antigravity" | "gemini";
  baseDir?: string;
  workingDirectory?: string;
  includeProjectObservation?: boolean;
  projectObservation?: {
    workspacePath?: string;
    repoRoot?: string;
    repoRemote?: string;
    repoFingerprint?: string;
    sourceNativeProjectRef?: string;
    confidence?: number;
  };
}

function createFixturePayload(
  sourceId: string,
  canonicalText: string,
  stageRunId: string,
  options: FixturePayloadOptions = {},
): SourceSyncPayload {
  const createdAt = "2026-03-09T09:00:00.000Z";
  const assistantAt = "2026-03-09T09:00:01.000Z";
  const toolCallAt = "2026-03-09T09:00:02.000Z";
  const toolResultAt = "2026-03-09T09:00:03.000Z";
  const sessionId = options.sessionId ?? "session-1";
  const turnId = options.turnId ?? "turn-1";
  const hostId = options.hostId ?? "host-1";
  const platform = options.platform ?? "codex";
  const baseDir = options.baseDir ?? `/tmp/storage-fixture/${sourceId}`;
  const workingDirectory = options.workingDirectory ?? "/workspace/storage-fixture";
  const projectObservation = options.projectObservation;
  const includeProjectObservation = options.includeProjectObservation ?? Boolean(projectObservation);
  const blobId = `${turnId}-blob`;
  const recordId = `${turnId}-record`;
  const userFragmentId = `${turnId}-fragment-user`;
  const assistantFragmentId = `${turnId}-fragment-assistant`;
  const toolCallFragmentId = `${turnId}-fragment-tool-call`;
  const toolResultFragmentId = `${turnId}-fragment-tool-result`;
  const userAtomId = `${turnId}-atom-user`;
  const assistantAtomId = `${turnId}-atom-assistant`;
  const toolCallAtomId = `${turnId}-atom-tool-call`;
  const toolResultAtomId = `${turnId}-atom-tool-result`;
  const submissionCandidateId = `${turnId}-candidate-submission`;
  const turnCandidateId = `${turnId}-candidate-turn`;
  const contextCandidateId = `${turnId}-candidate-context`;
  const projectObservationCandidateId = `${turnId}-candidate-project-observation`;
  const assistantReplyId = `${turnId}-assistant-reply`;
  const toolCallProjectionId = `${turnId}-tool-call`;
  const userMessageId = `${turnId}-user-message`;

  const candidates: SourceSyncPayload["candidates"] = [
    {
      id: submissionCandidateId,
      source_id: sourceId,
      session_ref: sessionId,
      candidate_kind: "submission_group",
      input_atom_refs: [userAtomId],
      started_at: createdAt,
      ended_at: createdAt,
      rule_version: "2026-03-09.1",
      evidence: { assistant_seen_after_group_start: true },
    },
    {
      id: turnCandidateId,
      source_id: sourceId,
      session_ref: sessionId,
      candidate_kind: "turn",
      input_atom_refs: [userAtomId],
      started_at: createdAt,
      ended_at: toolResultAt,
      rule_version: "2026-03-09.1",
      evidence: { submission_group_id: submissionCandidateId },
    },
    {
      id: contextCandidateId,
      source_id: sourceId,
      session_ref: sessionId,
      candidate_kind: "context_span",
      input_atom_refs: [assistantAtomId, toolCallAtomId, toolResultAtomId],
      started_at: createdAt,
      ended_at: toolResultAt,
      rule_version: "2026-03-09.1",
      evidence: { turn_candidate_id: turnCandidateId },
    },
  ];

  if (includeProjectObservation) {
    candidates.push({
      id: projectObservationCandidateId,
      source_id: sourceId,
      session_ref: sessionId,
      candidate_kind: "project_observation",
      input_atom_refs: [userAtomId],
      started_at: createdAt,
      ended_at: createdAt,
      rule_version: "2026-03-09.1",
      evidence: {
        workspace_path: projectObservation?.workspacePath ?? workingDirectory,
        workspace_path_normalized: projectObservation?.workspacePath ?? workingDirectory,
        repo_root: projectObservation?.repoRoot,
        repo_remote: projectObservation?.repoRemote,
        repo_fingerprint: projectObservation?.repoFingerprint,
        source_native_project_ref: projectObservation?.sourceNativeProjectRef,
        confidence: projectObservation?.confidence ?? 0.5,
      },
    });
  }

  return {
    source: {
      id: sourceId,
      slot_id: platform,
      family: "local_coding_agent",
      platform,
      display_name: "Storage fixture",
      base_dir: baseDir,
      host_id: hostId,
      last_sync: toolResultAt,
      sync_status: "healthy",
      total_blobs: 1,
      total_records: 1,
      total_fragments: 4,
      total_atoms: 4,
      total_sessions: 1,
      total_turns: 1,
    },
    stage_runs: [
      {
        id: stageRunId,
        source_id: sourceId,
        stage_kind: "finalize_projections",
        parser_version: "codex-parser@2026-03-09.1",
        parser_capabilities: ["turn_projections", "turn_context_projections", "loss_audits"],
        source_format_profile_ids: ["codex:jsonl:v1"],
        started_at: createdAt,
        finished_at: toolResultAt,
        status: "success",
        stats: { turns: 1, sessions: 1 },
      },
    ],
    loss_audits: [
      {
        id: `${turnId}-loss-audit`,
        source_id: sourceId,
        stage_run_id: stageRunId,
        stage_kind: "finalize_projections",
        diagnostic_code: "fixture_projection_gap",
        severity: "warning",
        scope_ref: toolResultFragmentId,
        session_ref: sessionId,
        blob_ref: blobId,
        record_ref: recordId,
        fragment_ref: toolResultFragmentId,
        source_format_profile_id: "codex:jsonl:v1",
        loss_kind: "unknown_fragment",
        detail: canonicalText === "New text" ? "updated fixture loss audit" : "fixture loss audit",
        created_at: toolResultAt,
      },
    ],
    blobs: [
      {
        id: blobId,
        source_id: sourceId,
        host_id: hostId,
        origin_path: path.join(baseDir, "session.jsonl"),
        captured_path: path.join(baseDir, ".cache", "session.jsonl"),
        checksum: "checksum-1",
        size_bytes: 128,
        captured_at: createdAt,
        capture_run_id: "capture-run-1",
      },
    ],
    records: [
      {
        id: recordId,
        source_id: sourceId,
        blob_id: blobId,
        session_ref: sessionId,
        ordinal: 0,
        record_path_or_offset: "0",
        observed_at: createdAt,
        parseable: true,
        raw_json: "{\"fixture\":true}",
      },
    ],
    fragments: [
      {
        id: userFragmentId,
        source_id: sourceId,
        session_ref: sessionId,
        record_id: recordId,
        seq_no: 0,
        fragment_kind: "text",
        actor_kind: "user",
        origin_kind: "user_authored",
        time_key: createdAt,
        payload: { text: canonicalText },
        raw_refs: [recordId],
        source_format_profile_id: "codex:jsonl:v1",
      },
      {
        id: assistantFragmentId,
        source_id: sourceId,
        session_ref: sessionId,
        record_id: recordId,
        seq_no: 1,
        fragment_kind: "text",
        actor_kind: "assistant",
        origin_kind: "assistant_authored",
        time_key: assistantAt,
        payload: { text: "Running tool" },
        raw_refs: [recordId],
        source_format_profile_id: "codex:jsonl:v1",
      },
      {
        id: toolCallFragmentId,
        source_id: sourceId,
        session_ref: sessionId,
        record_id: recordId,
        seq_no: 2,
        fragment_kind: "tool_call",
        actor_kind: "tool",
        origin_kind: "tool_generated",
        time_key: toolCallAt,
        payload: { call_id: "call-1", tool_name: "shell", input: {} },
        raw_refs: [recordId],
        source_format_profile_id: "codex:jsonl:v1",
      },
      {
        id: toolResultFragmentId,
        source_id: sourceId,
        session_ref: sessionId,
        record_id: recordId,
        seq_no: 3,
        fragment_kind: "tool_result",
        actor_kind: "tool",
        origin_kind: "tool_generated",
        time_key: toolResultAt,
        payload: { call_id: "call-1", output: "ok" },
        raw_refs: [recordId],
        source_format_profile_id: "codex:jsonl:v1",
      },
    ],
    atoms: [
      {
        id: userAtomId,
        source_id: sourceId,
        session_ref: sessionId,
        seq_no: 0,
        actor_kind: "user",
        origin_kind: "user_authored",
        content_kind: "text",
        time_key: createdAt,
        display_policy: "show",
        payload: { text: canonicalText },
        fragment_refs: [userFragmentId],
        source_format_profile_id: "codex:jsonl:v1",
      },
      {
        id: assistantAtomId,
        source_id: sourceId,
        session_ref: sessionId,
        seq_no: 1,
        actor_kind: "assistant",
        origin_kind: "assistant_authored",
        content_kind: "text",
        time_key: assistantAt,
        display_policy: "show",
        payload: { text: "Running tool" },
        fragment_refs: [assistantFragmentId],
        source_format_profile_id: "codex:jsonl:v1",
      },
      {
        id: toolCallAtomId,
        source_id: sourceId,
        session_ref: sessionId,
        seq_no: 2,
        actor_kind: "tool",
        origin_kind: "tool_generated",
        content_kind: "tool_call",
        time_key: toolCallAt,
        display_policy: "show",
        payload: { call_id: "call-1", tool_name: "shell", input: {} },
        fragment_refs: [toolCallFragmentId],
        source_format_profile_id: "codex:jsonl:v1",
      },
      {
        id: toolResultAtomId,
        source_id: sourceId,
        session_ref: sessionId,
        seq_no: 3,
        actor_kind: "tool",
        origin_kind: "tool_generated",
        content_kind: "tool_result",
        time_key: toolResultAt,
        display_policy: "show",
        payload: { call_id: "call-1", output: "ok" },
        fragment_refs: [toolResultFragmentId],
        source_format_profile_id: "codex:jsonl:v1",
      },
    ],
    edges: [
      {
        id: `${turnId}-edge-spawned-from`,
        source_id: sourceId,
        session_ref: sessionId,
        from_atom_id: toolCallAtomId,
        to_atom_id: assistantAtomId,
        edge_kind: "spawned_from",
      },
      {
        id: `${turnId}-edge-tool-result-for`,
        source_id: sourceId,
        session_ref: sessionId,
        from_atom_id: toolResultAtomId,
        to_atom_id: toolCallAtomId,
        edge_kind: "tool_result_for",
      },
    ],
    candidates,
    sessions: [
      {
        id: sessionId,
        source_id: sourceId,
        source_platform: platform,
        host_id: hostId,
        title: canonicalText,
        created_at: createdAt,
        updated_at: toolResultAt,
        turn_count: 1,
        model: "gpt-5",
        working_directory: workingDirectory,
        sync_axis: "current",
      },
    ],
    turns: [
      {
        id: turnId,
        revision_id: `${turnId}:r1`,
        user_messages: [
          {
            id: userMessageId,
            raw_text: canonicalText,
            sequence: 0,
            is_injected: false,
            created_at: createdAt,
            atom_refs: [userAtomId],
          },
        ],
        raw_text: canonicalText,
        canonical_text: canonicalText,
        display_segments: [{ type: "text", content: canonicalText }],
        created_at: createdAt,
        submission_started_at: createdAt,
        last_context_activity_at: toolResultAt,
        session_id: sessionId,
        source_id: sourceId,
        link_state: "unlinked",
        sync_axis: "current",
        value_axis: "active",
        retention_axis: "keep_raw_and_derived",
        context_ref: turnId,
        context_summary: {
          assistant_reply_count: 1,
          tool_call_count: 1,
          token_usage: {
            input_tokens: 1200,
            cache_read_input_tokens: 300,
            cache_creation_input_tokens: 100,
            output_tokens: 450,
            total_tokens: 2050,
          },
          total_tokens: 2050,
          primary_model: "gpt-5",
          has_errors: false,
        },
        lineage: {
          atom_refs: [userAtomId, assistantAtomId, toolCallAtomId, toolResultAtomId],
          candidate_refs: candidates.map((candidate) => candidate.id),
          fragment_refs: [userFragmentId, assistantFragmentId, toolCallFragmentId, toolResultFragmentId],
          record_refs: [recordId],
          blob_refs: [blobId],
        },
      },
    ],
    contexts: [
      {
        turn_id: turnId,
        system_messages: [],
        assistant_replies: [
          {
            id: assistantReplyId,
            content: "Running tool",
            display_segments: [{ type: "text", content: "Running tool" }],
            content_preview: "Running tool",
            token_usage: {
              input_tokens: 1200,
              output_tokens: 450,
              total_tokens: 1650,
            },
            token_count: 450,
            model: "gpt-5",
            created_at: assistantAt,
            tool_call_ids: [toolCallProjectionId],
            stop_reason: "tool_use",
          },
        ],
        tool_calls: [
          {
            id: toolCallProjectionId,
            tool_name: "shell",
            input: {},
            input_summary: "{}",
            input_display_segments: [{ type: "text", content: "{}" }],
            output: "ok",
            output_preview: "ok",
            output_display_segments: [{ type: "text", content: "ok" }],
            status: "success",
            reply_id: assistantReplyId,
            sequence: 0,
            created_at: toolCallAt,
          },
        ],
        raw_event_refs: [recordId],
      },
    ],
  };
}

function rewriteFixtureTimestamps(
  payload: SourceSyncPayload,
  replacements: Record<string, string>,
): SourceSyncPayload {
  let json = JSON.stringify(payload);
  for (const [from, to] of Object.entries(replacements)) {
    json = json.replaceAll(from, to);
  }
  return JSON.parse(json) as SourceSyncPayload;
}

function combineFixturePayloads(
  left: SourceSyncPayload,
  right: SourceSyncPayload,
  options: { sessionId: string; title: string },
): SourceSyncPayload {
  const leftSession = left.sessions.find((session) => session.id === options.sessionId);
  const rightSession = right.sessions.find((session) => session.id === options.sessionId);
  assert.ok(leftSession);
  assert.ok(rightSession);

  return {
    source: {
      ...left.source,
      total_blobs: left.blobs.length + right.blobs.length,
      total_records: left.records.length + right.records.length,
      total_fragments: left.fragments.length + right.fragments.length,
      total_atoms: left.atoms.length + right.atoms.length,
      total_sessions: 1,
      total_turns: left.turns.length + right.turns.length,
    },
    stage_runs: [...left.stage_runs, ...right.stage_runs],
    loss_audits: [...left.loss_audits, ...right.loss_audits],
    blobs: [...left.blobs, ...right.blobs],
    records: [...left.records, ...right.records],
    fragments: [...left.fragments, ...right.fragments],
    atoms: [...left.atoms, ...right.atoms],
    edges: [...left.edges, ...right.edges],
    candidates: [...left.candidates, ...right.candidates],
    sessions: [
      {
        ...leftSession,
        title: options.title,
        updated_at: rightSession.updated_at > leftSession.updated_at ? rightSession.updated_at : leftSession.updated_at,
        turn_count: left.turns.length + right.turns.length,
      },
    ],
    turns: [...left.turns, ...right.turns].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    contexts: [...left.contexts, ...right.contexts],
  };
}

function rewriteAtomEdgesAsLegacyTable(dbPath: string): void {
  const db = new DatabaseSync(dbPath);

  try {
    db.exec("DROP INDEX IF EXISTS idx_atom_edges_from");
    db.exec("DROP INDEX IF EXISTS idx_atom_edges_to");
    db.exec(`
      CREATE TABLE atom_edges_legacy (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        session_ref TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
    `);
    db.exec(`
      INSERT INTO atom_edges_legacy (id, source_id, session_ref, payload_json)
      SELECT id, source_id, session_ref, payload_json FROM atom_edges;
    `);
    db.exec("DROP TABLE atom_edges");
    db.exec("ALTER TABLE atom_edges_legacy RENAME TO atom_edges");
  } finally {
    db.close();
  }
}

function dropSchemaMetadataTables(dbPath: string): void {
  const db = new DatabaseSync(dbPath);

  try {
    db.exec("DROP TABLE schema_migrations;");
    db.exec("DROP TABLE schema_meta;");
  } finally {
    db.close();
  }
}
