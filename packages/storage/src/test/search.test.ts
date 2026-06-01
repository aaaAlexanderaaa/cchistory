import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import assert from "node:assert/strict";
import { CCHistoryStorage, matchesSearchCandidateQuery } from "../index.js";
import { combineFixturePayloads, createFixturePayload } from "./helpers.js";

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

test("matchesSearchCandidateQuery targets canonical and path text only", () => {
  const candidate = {
    canonical_text: "canonical metadata target",
  };

  assert.equal(matchesSearchCandidateQuery(candidate, "meta"), true);
  assert.equal(matchesSearchCandidateQuery(candidate, "metad"), true);
  assert.equal(matchesSearchCandidateQuery(candidate, "metadata target"), true);
  assert.equal(matchesSearchCandidateQuery(candidate, "alpha"), false);
  assert.equal(matchesSearchCandidateQuery({ canonical_text: "unrelated prompt body" }, "metadata target"), false);
  assert.equal(
    matchesSearchCandidateQuery(
      { canonical_text: "unrelated prompt body", path_text: "/workspace/metadata-target" },
      "metadata-target",
    ),
    true,
  );
  const rawOnlyCandidate = { canonical_text: "unrelated prompt body", raw_text: "metadata target" };
  assert.equal(matchesSearchCandidateQuery(rawOnlyCandidate, "metadata target"), false);
});

test("opening a store with the old FTS schema rebuilds the new search index", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-search-old-fts-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    if (storage.searchMode !== "fts5") {
      storage.close();
      t.skip("FTS5 is unavailable in this Node SQLite build");
      return;
    }
    storage.replaceSourcePayload(
      createFixturePayload("src-search-old-fts", "Canonical upgraded search target", "sr-old-fts", {
        turnId: "turn-old-fts",
        sessionId: "session-old-fts",
      }),
    );
    storage.close();

    const db = new DatabaseSync(path.join(dataDir, "cchistory.sqlite"));
    try {
      db.exec(`
        DROP TABLE IF EXISTS search_index;
        DROP TABLE IF EXISTS search_index_config;
        DROP TABLE IF EXISTS search_index_content;
        DROP TABLE IF EXISTS search_index_data;
        DROP TABLE IF EXISTS search_index_docsize;
        DROP TABLE IF EXISTS search_index_idx;
        DROP TABLE IF EXISTS search_index_hashes;
        CREATE VIRTUAL TABLE search_index USING fts5(
          turn_id UNINDEXED,
          project_id UNINDEXED,
          source_id UNINDEXED,
          link_state UNINDEXED,
          value_axis UNINDEXED,
          canonical_text,
          raw_text,
          tokenize = 'unicode61 porter'
        );
        INSERT INTO search_index (
          turn_id,
          project_id,
          source_id,
          link_state,
          value_axis,
          canonical_text,
          raw_text
        ) VALUES (
          'turn-old-fts',
          '',
          'src-search-old-fts',
          'unlinked',
          'active',
          'Canonical upgraded search target',
          ''
        );
      `);
    } finally {
      db.close();
    }

    const upgradedStorage = new CCHistoryStorage(dataDir);
    try {
      const results = upgradedStorage.searchTurns({ query: "upgraded search target" });
      assert.deepEqual(results.map((result) => result.turn.id), ["turn-old-fts"]);
    } finally {
      upgradedStorage.close();
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("opening a store after a crash between the FTS drop and rebuild still rebuilds", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-search-crash-recovery-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    if (storage.searchMode !== "fts5") {
      storage.close();
      t.skip("FTS5 is unavailable in this Node SQLite build");
      return;
    }
    storage.replaceSourcePayload(
      createFixturePayload("src-search-crash-recovery", "Crash recovery target", "sr-crash-recovery", {
        turnId: "turn-crash-recovery",
        sessionId: "session-crash-recovery",
      }),
    );
    storage.close();

    // Simulate a crash between ensureSearchIndex's DROP and the constructor's
    // successful replaceSearchIndex: the table is current-schema (path_text
    // exists) and empty, and the durable marker is set to "needs_rebuild".
    const db = new DatabaseSync(path.join(dataDir, "cchistory.sqlite"));
    try {
      db.exec(`
        DROP TABLE IF EXISTS search_index;
        DROP TABLE IF EXISTS search_index_config;
        DROP TABLE IF EXISTS search_index_content;
        DROP TABLE IF EXISTS search_index_data;
        DROP TABLE IF EXISTS search_index_docsize;
        DROP TABLE IF EXISTS search_index_idx;
        DROP TABLE IF EXISTS search_index_hashes;
        CREATE VIRTUAL TABLE search_index USING fts5(
          turn_id UNINDEXED,
          project_id UNINDEXED,
          source_id UNINDEXED,
          link_state UNINDEXED,
          value_axis UNINDEXED,
          canonical_text,
          path_text,
          raw_text,
          tokenize = 'unicode61 porter'
        );
        INSERT OR REPLACE INTO schema_meta (key, value_text, updated_at) VALUES (
          'search_index_status', 'needs_rebuild', '${new Date().toISOString()}'
        );
      `);
    } finally {
      db.close();
    }

    const recoveredStorage = new CCHistoryStorage(dataDir);
    try {
      const results = recoveredStorage.searchTurns({ query: "crash recovery target" });
      assert.deepEqual(results.map((result) => result.turn.id), ["turn-crash-recovery"]);
    } finally {
      recoveredStorage.close();
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("searchTurns does not match raw-only turn text", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-search-raw-only-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const payload = createFixturePayload("src-search-raw-only", "Canonical visible prompt", "sr-raw-only", {
      turnId: "turn-raw-only",
      sessionId: "session-raw-only",
    });
    payload.turns[0]!.raw_text = "Raw-only Backlog target";
    storage.replaceSourcePayload(payload);

    const results = storage.searchTurns({ query: "backlog target" });
    assert.deepEqual(results.map((result) => result.turn.id), []);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("searchTurns requires all canonical query terms and ignores session metadata partial overlap", async () => {
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

test("searchTurns ignores metadata-only session matches", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-search-session-meta-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const first = createFixturePayload("src-search-session-meta", "Plan current UI work", "sr-session-meta-a", {
      sessionId: "session-session-meta",
      turnId: "turn-session-meta-a",
    });
    const second = createFixturePayload("src-search-session-meta", "Review unrelated output", "sr-session-meta-b", {
      sessionId: "session-session-meta",
      turnId: "turn-session-meta-b",
    });
    storage.replaceSourcePayload(
      combineFixturePayloads(first, second, {
        sessionId: "session-session-meta",
        title: "Backlog planning session",
      }),
    );

    const results = storage.searchTurns({ query: "back" });
    assert.deepEqual(
      results.map((result) => result.turn.id),
      [],
      "Default search should not surface a turn solely because the session title matches",
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("searchTurns matches session workspace path fragments and basenames", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-search-path-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-search-path", "Audit unrelated prompt", "sr-search-path", {
        turnId: "turn-search-path",
        sessionId: "session-search-path",
        workingDirectory: "/Users/mock_user/workspace/cchistory-resume-audit",
      }),
    );

    assert.deepEqual(
      storage.searchTurns({ query: "/Users/mock_user/workspace/cchistory-resume-audit" }).map((result) => result.turn.id),
      ["turn-search-path"],
    );
    assert.deepEqual(
      storage.searchTurns({ query: "cchistory-resume-audit" }).map((result) => result.turn.id),
      ["turn-search-path"],
    );
    assert.deepEqual(
      storage.searchTurns({ query: "workspace cchistory-resume-audit" }).map((result) => result.turn.id),
      ["turn-search-path"],
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("searchTurns matches project workspace path from project observations", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-search-project-path-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-search-project-path", "Review projection unrelated", "sr-search-project-path", {
        turnId: "turn-search-project-path",
        sessionId: "session-search-project-path",
        workingDirectory: "/tmp/transient-session-cwd",
        projectObservation: {
          workspacePath: "/Users/mock_user/workspace/provider-isolated-history",
          repoRoot: "/Users/mock_user/workspace/provider-isolated-history",
          repoFingerprint: "fp-provider-isolated-history",
          sourceNativeProjectRef: "-Users-mock-user-workspace-provider-isolated-history",
        },
      }),
    );

    assert.deepEqual(
      storage.searchTurns({ query: "provider-isolated-history" }).map((result) => result.turn.id),
      ["turn-search-project-path"],
    );
    assert.deepEqual(
      storage.searchTurns({ query: "-Users-mock-user-workspace-provider-isolated-history" }).map((result) => result.turn.id),
      ["turn-search-project-path"],
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("searchTurns does not add metadata-only siblings when a session has direct canonical hits", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-search-session-direct-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const direct = createFixturePayload("src-search-session-direct", "Backlog direct prompt", "sr-session-direct-a", {
      sessionId: "session-session-direct",
      turnId: "turn-session-direct-a",
    });
    const sibling = createFixturePayload("src-search-session-direct", "Review unrelated output", "sr-session-direct-b", {
      sessionId: "session-session-direct",
      turnId: "turn-session-direct-b",
    });
    storage.replaceSourcePayload(
      combineFixturePayloads(direct, sibling, {
        sessionId: "session-session-direct",
        title: "Backlog planning session",
      }),
    );

    const results = storage.searchTurns({ query: "back" });
    assert.deepEqual(
      results.map((result) => result.turn.id),
      ["turn-session-direct-a"],
      "A direct canonical hit should not drag in sibling turns through matching session metadata",
    );
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
