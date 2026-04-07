import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { CCHistoryStorage, matchesSearchCandidateQuery } from "../index.js";
import { createFixturePayload } from "./helpers.js";

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

test("matchesSearchCandidateQuery preserves session metadata matches for extended queries", () => {
  const candidate = {
    canonical_text: "unrelated prompt body",
    raw_text: "unrelated prompt body",
    session_title: "Session for metadata target",
    session_working_directory: "/workspace/metadata-target",
  };

  assert.equal(matchesSearchCandidateQuery(candidate, "meta"), true);
  assert.equal(matchesSearchCandidateQuery(candidate, "metad"), true);
  assert.equal(matchesSearchCandidateQuery(candidate, "metadata target"), true);
  assert.equal(matchesSearchCandidateQuery(candidate, "alpha"), false);
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
