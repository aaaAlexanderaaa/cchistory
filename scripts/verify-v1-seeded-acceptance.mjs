import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { CCHistoryStorage } from "../packages/storage/dist/index.js";
import { createApiRuntime } from "../apps/api/dist/app.js";
import { runCli } from "../apps/cli/dist/index.js";
import { runTui } from "../apps/tui/dist/index.js";

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.materializeOnly) {
    if (!args.storeDir) {
      throw new Error("`--materialize-only` requires `--store <dir>`.");
    }
    const seeded = seedAcceptanceStore(args.storeDir);
    console.log(`Seeded V1 web-review store written to ${args.storeDir}.`);
    console.log(`Primary project: ${seeded.project.display_name} (${seeded.project.project_id})`);
    console.log(`Traceability turn: ${seeded.targetTurn.id} in session ${seeded.targetTurn.session_id}`);
    console.log(`Start canonical services manually with: CCHISTORY_API_DATA_DIR=${args.storeDir} pnpm services:start`);
    return;
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-v1-seeded-acceptance-"));

  try {
    const storeDir = args.storeDir ?? path.join(tempRoot, "seeded-store");
    const seeded = seedAcceptanceStore(storeDir);

    await verifyCli(storeDir, tempRoot, seeded);
    await verifyApi(storeDir, seeded);
    await verifyTui(storeDir, tempRoot, seeded);
    await verifySourceSummaries(storeDir, tempRoot);
    await verifyRestoreReadability(storeDir, tempRoot, seeded);

    console.log(`V1 seeded acceptance passed for ${seeded.project.display_name} (${seeded.project.project_id}).`);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  let materializeOnly = false;
  let storeDir;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--") {
      continue;
    }
    if (value === "--materialize-only") {
      materializeOnly = true;
      continue;
    }
    if (value === "--store") {
      const nextValue = argv[index + 1];
      if (!nextValue) {
        throw new Error("`--store` requires a directory path.");
      }
      storeDir = path.resolve(nextValue);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${value}`);
  }

  return { materializeOnly, storeDir };
}

export function seedAcceptanceStore(storeDir) {
  const storage = new CCHistoryStorage(storeDir);
  const fixtureRoot = path.join(path.dirname(storeDir), "source-fixtures");

  try {
    const alphaProject = {
      workspacePath: "/workspace/alpha-history",
      repoRoot: "/workspace/alpha-history",
      repoFingerprint: "repo-fingerprint-alpha-history",
    };
    const betaProject = {
      workspacePath: "/workspace/beta-compare",
      repoRoot: "/workspace/beta-compare",
      repoFingerprint: "repo-fingerprint-beta-compare",
    };

    storage.replaceSourcePayload(
      createAcceptancePayload("src-alpha-codex", "Alpha kickoff regression note", {
        sourceBaseDir: ensureFixtureSourceFile(fixtureRoot, "src-alpha-codex"),
        sessionId: "session-alpha-codex",
        turnId: "turn-alpha-codex",
        hostId: "host-acceptance",
        platform: "codex",
        workingDirectory: alphaProject.workspacePath,
        projectObservation: alphaProject,
        createdAt: "2026-04-01T08:00:00.000Z",
      }),
    );
    storage.replaceSourcePayload(
      createAcceptancePayload("src-alpha-claude", "Alpha API parity review", {
        sourceBaseDir: ensureFixtureSourceFile(fixtureRoot, "src-alpha-claude"),
        sessionId: "session-alpha-claude",
        turnId: "turn-alpha-claude",
        hostId: "host-acceptance",
        platform: "claude_code",
        workingDirectory: alphaProject.workspacePath,
        projectObservation: alphaProject,
        createdAt: "2026-04-01T08:10:00.000Z",
      }),
    );
    storage.replaceSourcePayload(
      createAcceptancePayload("src-alpha-amp", "Alpha traceability target", {
        sourceBaseDir: ensureFixtureSourceFile(fixtureRoot, "src-alpha-amp"),
        sessionId: "session-alpha-amp",
        turnId: "turn-alpha-amp",
        hostId: "host-acceptance",
        platform: "amp",
        workingDirectory: alphaProject.workspacePath,
        projectObservation: alphaProject,
        createdAt: "2026-04-01T08:20:00.000Z",
      }),
    );
    storage.replaceSourcePayload(
      createAcceptancePayload("src-beta-factory", "Beta comparison turn", {
        sourceBaseDir: ensureFixtureSourceFile(fixtureRoot, "src-beta-factory"),
        sessionId: "session-beta-factory",
        turnId: "turn-beta-factory",
        hostId: "host-acceptance",
        platform: "factory_droid",
        workingDirectory: betaProject.workspacePath,
        projectObservation: betaProject,
        createdAt: "2026-04-01T07:30:00.000Z",
      }),
    );

    const project = storage.listProjects().find((entry) => entry.display_name === "alpha-history");
    assert.ok(project, "expected committed alpha-history project in seeded store");
    assert.equal(project.linkage_state, "committed");
    assert.deepEqual(project.source_platforms, ["amp", "claude_code", "codex"]);

    const turns = storage.listProjectTurns(project.project_id, "all");
    assert.equal(turns.length, 3);
    const targetTurn = turns.find((turn) => turn.id === "turn-alpha-amp");
    assert.ok(targetTurn, "expected seeded target turn in alpha-history project");

    const targetContext = storage.getTurnContext(targetTurn.id);
    assert.ok(targetContext, "expected seeded target context");
    assert.equal(targetContext.assistant_replies.length, 1);
    assert.equal(targetContext.tool_calls.length, 1);

    return { project, targetTurn, targetContext };
  } finally {
    storage.close();
  }
}

async function verifyCli(storeDir, cwd, seeded) {
  const projects = await runCliJson(["query", "projects", "--store", storeDir], cwd);
  const project = projects.find((entry) => entry.project_id === seeded.project.project_id);
  assert.ok(project, "CLI should return the seeded alpha-history project");
  assert.equal(project.display_name, seeded.project.display_name);
  assert.equal(project.linkage_state, "committed");
  assert.deepEqual(project.source_platforms, ["amp", "claude_code", "codex"]);

  const projectTurns = await runCliJson(["query", "turns", "--project", seeded.project.project_id, "--store", storeDir], cwd);
  assert.equal(projectTurns.length, 3);
  assert.ok(projectTurns.some((turn) => turn.id === seeded.targetTurn.id));

  const searchResults = await runCliJson(["search", "Alpha traceability target", "--store", storeDir], cwd);
  assert.equal(searchResults.kind, "search");
  assert.equal(searchResults.query, "Alpha traceability target");
  assert.equal(searchResults.results.length, 1);
  const searchHit = searchResults.results[0];
  assert.equal(searchHit.turn.id, seeded.targetTurn.id);
  assert.equal(searchHit.turn.project_id, seeded.project.project_id);
  assert.equal(searchHit.turn.session_id, seeded.targetTurn.session_id);

  const turnDetail = await runCliJson(["show", "turn", searchHit.turn.id, "--store", storeDir], cwd);
  assert.equal(turnDetail.turn.project_id, seeded.project.project_id);
  assert.equal(turnDetail.turn.session_id, seeded.targetTurn.session_id);
  assert.match(turnDetail.turn.canonical_text, /Alpha traceability target/);
  assert.equal(turnDetail.context?.assistant_replies.length, 1);
  assert.equal(turnDetail.context?.tool_calls.length, 1);

  const sessionDetail = await runCliJson(["show", "session", searchHit.turn.session_id, "--store", storeDir], cwd);
  assert.equal(sessionDetail.session.id, seeded.targetTurn.session_id);
  assert.equal(sessionDetail.session.primary_project_id, seeded.project.project_id);
  assert.ok(sessionDetail.turns.some((turn) => turn.id === seeded.targetTurn.id));
}

async function verifyApi(storeDir, seeded) {
  const runtime = await createApiRuntime({ dataDir: storeDir, sources: [] });

  try {
    const projectsResponse = await runtime.app.inject({ method: "GET", url: "/api/projects" });
    assert.equal(projectsResponse.statusCode, 200);
    const projectsBody = JSON.parse(projectsResponse.body);
    const project = projectsBody.projects.find((entry) => entry.project_id === seeded.project.project_id);
    assert.ok(project, "API should return the seeded alpha-history project");
    assert.equal(project.display_name, seeded.project.display_name);
    assert.deepEqual(project.source_platforms, ["amp", "claude_code", "codex"]);

    const turnsResponse = await runtime.app.inject({
      method: "GET",
      url: `/api/projects/${seeded.project.project_id}/turns`,
    });
    assert.equal(turnsResponse.statusCode, 200);
    const turnsBody = JSON.parse(turnsResponse.body);
    assert.equal(turnsBody.turns.length, 3);
    assert.ok(turnsBody.turns.some((turn) => turn.id === seeded.targetTurn.id));

    const searchResponse = await runtime.app.inject({
      method: "GET",
      url: `/api/turns/search?q=${encodeURIComponent("Alpha traceability target")}`,
    });
    assert.equal(searchResponse.statusCode, 200);
    const searchBody = JSON.parse(searchResponse.body);
    assert.equal(searchBody.results.length, 1);
    const searchHit = searchBody.results[0];
    assert.equal(searchHit.turn.id, seeded.targetTurn.id);
    assert.equal(searchHit.turn.project_id, seeded.project.project_id);
    assert.equal(searchHit.turn.session_id, seeded.targetTurn.session_id);

    const turnResponse = await runtime.app.inject({
      method: "GET",
      url: `/api/turns/${searchHit.turn.id}`,
    });
    assert.equal(turnResponse.statusCode, 200);
    const turnBody = JSON.parse(turnResponse.body);
    assert.equal(turnBody.turn.project_id, seeded.project.project_id);
    assert.equal(turnBody.turn.session_id, seeded.targetTurn.session_id);
    assert.match(turnBody.turn.canonical_text, /Alpha traceability target/);

    const contextResponse = await runtime.app.inject({
      method: "GET",
      url: `/api/turns/${searchHit.turn.id}/context`,
    });
    assert.equal(contextResponse.statusCode, 200);
    const contextBody = JSON.parse(contextResponse.body);
    assert.equal(contextBody.context.assistant_replies.length, 1);
    assert.equal(contextBody.context.tool_calls.length, 1);

    const sessionResponse = await runtime.app.inject({
      method: "GET",
      url: `/api/sessions/${searchHit.turn.session_id}`,
    });
    assert.equal(sessionResponse.statusCode, 200);
    const sessionBody = JSON.parse(sessionResponse.body);
    assert.equal(sessionBody.session.primary_project_id, seeded.project.project_id);
  } finally {
    await runtime.app.close();
    runtime.storage.close();
  }
}

async function verifyTui(storeDir, cwd, seeded) {
  const browseIo = createIo(cwd);
  const browseExitCode = await runTui(["--store", storeDir], browseIo.io);
  const browseOutput = browseIo.stdout.join("");

  assert.equal(browseExitCode, 0, browseIo.stderr.join(""));
  assert.match(browseOutput, /CCHistory TUI entrypoint/);
  assert.match(browseOutput, /Projects(?: \[active\])?:/);
  assert.match(browseOutput, /Turns(?: \[active\])?:/);
  assert.match(browseOutput, /Detail(?: \[active\])?:/);
  assert.match(browseOutput, new RegExp(seeded.project.display_name));
  assert.match(browseOutput, /Alpha traceability target/);
  assert.match(browseOutput, new RegExp(`Session: ${seeded.targetTurn.session_id}`));
  assert.match(browseOutput, /Assistant: Processing\./);
  assert.match(browseOutput, /Context counts: 1 replies, 1 tools, 0 system/);

  const searchIo = createIo(cwd);
  const searchExitCode = await runTui(["--store", storeDir, "--search", "Alpha traceability target"], searchIo.io);
  const searchOutput = searchIo.stdout.join("");

  assert.equal(searchExitCode, 0, searchIo.stderr.join(""));
  assert.match(searchOutput, /Mode=search/);
  assert.match(searchOutput, /Search(?: \[active\])?:/);
  assert.match(searchOutput, /Results(?: \[active\])?:/);
  assert.match(searchOutput, /Query: Alpha traceability target/);
  assert.match(searchOutput, /Alpha traceability target/);
  assert.match(searchOutput, new RegExp(`Session: ${seeded.targetTurn.session_id}`));
  assert.match(searchOutput, /Assistant: Processing\./);
  assert.match(searchOutput, /Context counts: 1 replies, 1 tools, 0 system/);
}

async function verifySourceSummaries(storeDir, cwd) {
  const cliSources = await runCliJson(["ls", "sources", "--store", storeDir], cwd);
  assert.equal(cliSources.kind, "sources");
  assert.equal(cliSources.sources.length, 4);
  assert.deepEqual(
    cliSources.sources.map((source) => source.platform).sort(),
    ["amp", "claude_code", "codex", "factory_droid"],
  );
  assert.ok(cliSources.sources.every((source) => source.total_turns === 1));

  const runtime = await createApiRuntime({ dataDir: storeDir, sources: [] });
  try {
    const response = await runtime.app.inject({ method: "GET", url: "/api/sources" });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.sources.length, 4);
    assert.deepEqual(
      body.sources.map((source) => source.platform).sort(),
      ["amp", "claude_code", "codex", "factory_droid"],
    );
    assert.ok(body.sources.every((source) => source.total_turns === 1));
  } finally {
    await runtime.app.close();
    runtime.storage.close();
  }
}

async function verifyRestoreReadability(storeDir, cwd, seeded) {
  const bundleDir = path.join(cwd, "seeded-acceptance-bundle");
  const restoredStoreDir = path.join(cwd, "restored-store");

  const exportResult = await runCliCapture(["export", "--store", storeDir, "--out", bundleDir], cwd);
  assert.equal(exportResult.exitCode, 0, exportResult.stderr);

  const importResult = await runCliCapture(["import", bundleDir, "--store", restoredStoreDir], cwd);
  assert.equal(importResult.exitCode, 0, importResult.stderr);

  const restoreCheck = await runCliJson(["restore-check", "--store", restoredStoreDir], cwd);
  assert.equal(restoreCheck.kind, "restore-check");
  assert.equal(restoreCheck.read_mode, "index");
  assert.equal(restoreCheck.stats.counts.sources, 4);
  assert.equal(restoreCheck.sources.sources.length, 4);

  const runtime = await createApiRuntime({ dataDir: restoredStoreDir, sources: [] });
  try {
    const projectsResponse = await runtime.app.inject({ method: "GET", url: "/api/projects" });
    assert.equal(projectsResponse.statusCode, 200);
    const projectsBody = JSON.parse(projectsResponse.body);
    assert.ok(projectsBody.projects.some((project) => project.project_id === seeded.project.project_id));

    const turnResponse = await runtime.app.inject({ method: "GET", url: `/api/turns/${seeded.targetTurn.id}` });
    assert.equal(turnResponse.statusCode, 200);
    const turnBody = JSON.parse(turnResponse.body);
    assert.equal(turnBody.turn.project_id, seeded.project.project_id);
    assert.match(turnBody.turn.canonical_text, /Alpha traceability target/);

    const contextResponse = await runtime.app.inject({ method: "GET", url: `/api/turns/${seeded.targetTurn.id}/context` });
    assert.equal(contextResponse.statusCode, 200);
    const contextBody = JSON.parse(contextResponse.body);
    assert.equal(contextBody.context.assistant_replies.length, 1);
    assert.equal(contextBody.context.tool_calls.length, 1);
  } finally {
    await runtime.app.close();
    runtime.storage.close();
  }
}

function ensureFixtureSourceFile(fixtureRoot, sourceId) {
  const sourceDir = path.join(fixtureRoot, sourceId);
  const cacheDir = path.join(sourceDir, ".cache");
  mkdirSync(cacheDir, { recursive: true });
  const contents = JSON.stringify({ fixture: sourceId }) + "\n";
  writeFileSync(path.join(sourceDir, "session.jsonl"), contents, "utf8");
  writeFileSync(path.join(cacheDir, "session.jsonl"), contents, "utf8");
  return sourceDir;
}

function createIo(cwd) {
  const stdout = [];
  const stderr = [];
  return {
    io: {
      cwd,
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
      isInteractiveTerminal: false,
    },
    stdout,
    stderr,
  };
}

async function runCliJson(argv, cwd) {
  const { io, stdout, stderr } = createIo(cwd);
  const exitCode = await runCli([...argv, "--json"], io);
  assert.equal(exitCode, 0, stderr.join(""));
  return JSON.parse(stdout.join(""));
}

async function runCliCapture(argv, cwd) {
  const { io, stdout, stderr } = createIo(cwd);
  const exitCode = await runCli(argv, io);
  return {
    exitCode,
    stdout: stdout.join(""),
    stderr: stderr.join(""),
  };
}

function createAcceptancePayload(sourceId, canonicalText, options) {
  const createdAt = options.createdAt;
  const assistantAt = shiftIso(createdAt, 1);
  const toolCallAt = shiftIso(createdAt, 2);
  const toolResultAt = shiftIso(createdAt, 3);
  const blobId = `${options.turnId}-blob`;
  const recordId = `${options.turnId}-record`;
  const userFragmentId = `${options.turnId}-fragment-user`;
  const assistantFragmentId = `${options.turnId}-fragment-assistant`;
  const toolCallFragmentId = `${options.turnId}-fragment-tool-call`;
  const toolResultFragmentId = `${options.turnId}-fragment-tool-result`;
  const userAtomId = `${options.turnId}-atom-user`;
  const assistantAtomId = `${options.turnId}-atom-assistant`;
  const toolCallAtomId = `${options.turnId}-atom-tool-call`;
  const toolResultAtomId = `${options.turnId}-atom-tool-result`;
  const projectObservationCandidateId = `${options.turnId}-candidate-project-observation`;

  return {
    source: {
      id: sourceId,
      slot_id: options.platform,
      family: "local_coding_agent",
      platform: options.platform,
      display_name: `${options.platform}:${options.turnId}`,
      base_dir: options.sourceBaseDir,
      host_id: options.hostId,
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
        id: `${options.turnId}-stage-run`,
        source_id: sourceId,
        stage_kind: "finalize_projections",
        parser_version: "fixture-parser@2026-04-01.1",
        parser_capabilities: ["turn_projections", "turn_context_projections", "project_observation_candidates"],
        source_format_profile_ids: [`${options.platform}:fixture:v1`],
        started_at: createdAt,
        finished_at: toolResultAt,
        status: "success",
        stats: { turns: 1, sessions: 1 },
      },
    ],
    loss_audits: [],
    blobs: [
      {
        id: blobId,
        source_id: sourceId,
        host_id: options.hostId,
        origin_path: path.join(options.sourceBaseDir, "session.jsonl"),
        captured_path: path.join(options.sourceBaseDir, ".cache", "session.jsonl"),
        checksum: `${sourceId}-checksum`,
        size_bytes: 128,
        captured_at: createdAt,
        capture_run_id: `${options.turnId}-capture-run`,
      },
    ],
    records: [
      {
        id: recordId,
        source_id: sourceId,
        blob_id: blobId,
        session_ref: options.sessionId,
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
        session_ref: options.sessionId,
        record_id: recordId,
        seq_no: 0,
        fragment_kind: "text",
        actor_kind: "user",
        origin_kind: "user_authored",
        time_key: createdAt,
        payload: { text: canonicalText },
        raw_refs: [recordId],
        source_format_profile_id: `${options.platform}:fixture:v1`,
      },
      {
        id: assistantFragmentId,
        source_id: sourceId,
        session_ref: options.sessionId,
        record_id: recordId,
        seq_no: 1,
        fragment_kind: "text",
        actor_kind: "assistant",
        origin_kind: "assistant_authored",
        time_key: assistantAt,
        payload: { text: "Processing." },
        raw_refs: [recordId],
        source_format_profile_id: `${options.platform}:fixture:v1`,
      },
      {
        id: toolCallFragmentId,
        source_id: sourceId,
        session_ref: options.sessionId,
        record_id: recordId,
        seq_no: 2,
        fragment_kind: "tool_call",
        actor_kind: "tool",
        origin_kind: "tool_generated",
        time_key: toolCallAt,
        payload: { call_id: "call-1", tool_name: "shell", input: {} },
        raw_refs: [recordId],
        source_format_profile_id: `${options.platform}:fixture:v1`,
      },
      {
        id: toolResultFragmentId,
        source_id: sourceId,
        session_ref: options.sessionId,
        record_id: recordId,
        seq_no: 3,
        fragment_kind: "tool_result",
        actor_kind: "tool",
        origin_kind: "tool_generated",
        time_key: toolResultAt,
        payload: { call_id: "call-1", output: "ok" },
        raw_refs: [recordId],
        source_format_profile_id: `${options.platform}:fixture:v1`,
      },
    ],
    atoms: [
      {
        id: userAtomId,
        source_id: sourceId,
        session_ref: options.sessionId,
        seq_no: 0,
        actor_kind: "user",
        origin_kind: "user_authored",
        content_kind: "text",
        time_key: createdAt,
        display_policy: "show",
        payload: { text: canonicalText },
        fragment_refs: [userFragmentId],
        source_format_profile_id: `${options.platform}:fixture:v1`,
      },
      {
        id: assistantAtomId,
        source_id: sourceId,
        session_ref: options.sessionId,
        seq_no: 1,
        actor_kind: "assistant",
        origin_kind: "assistant_authored",
        content_kind: "text",
        time_key: assistantAt,
        display_policy: "show",
        payload: { text: "Processing." },
        fragment_refs: [assistantFragmentId],
        source_format_profile_id: `${options.platform}:fixture:v1`,
      },
      {
        id: toolCallAtomId,
        source_id: sourceId,
        session_ref: options.sessionId,
        seq_no: 2,
        actor_kind: "tool",
        origin_kind: "tool_generated",
        content_kind: "tool_call",
        time_key: toolCallAt,
        display_policy: "show",
        payload: { call_id: "call-1", tool_name: "shell", input: {} },
        fragment_refs: [toolCallFragmentId],
        source_format_profile_id: `${options.platform}:fixture:v1`,
      },
      {
        id: toolResultAtomId,
        source_id: sourceId,
        session_ref: options.sessionId,
        seq_no: 3,
        actor_kind: "tool",
        origin_kind: "tool_generated",
        content_kind: "tool_result",
        time_key: toolResultAt,
        display_policy: "show",
        payload: { call_id: "call-1", output: "ok" },
        fragment_refs: [toolResultFragmentId],
        source_format_profile_id: `${options.platform}:fixture:v1`,
      },
    ],
    edges: [],
    candidates: [
      {
        id: `${options.turnId}-candidate-submission`,
        source_id: sourceId,
        session_ref: options.sessionId,
        candidate_kind: "submission_group",
        input_atom_refs: [userAtomId],
        started_at: createdAt,
        ended_at: createdAt,
        rule_version: "2026-04-01.1",
        evidence: {},
      },
      {
        id: `${options.turnId}-candidate-turn`,
        source_id: sourceId,
        session_ref: options.sessionId,
        candidate_kind: "turn",
        input_atom_refs: [userAtomId],
        started_at: createdAt,
        ended_at: toolResultAt,
        rule_version: "2026-04-01.1",
        evidence: {},
      },
      {
        id: `${options.turnId}-candidate-context`,
        source_id: sourceId,
        session_ref: options.sessionId,
        candidate_kind: "context_span",
        input_atom_refs: [assistantAtomId, toolCallAtomId, toolResultAtomId],
        started_at: createdAt,
        ended_at: toolResultAt,
        rule_version: "2026-04-01.1",
        evidence: {},
      },
      {
        id: projectObservationCandidateId,
        source_id: sourceId,
        session_ref: options.sessionId,
        candidate_kind: "project_observation",
        input_atom_refs: [userAtomId],
        started_at: createdAt,
        ended_at: createdAt,
        rule_version: "2026-04-01.1",
        evidence: {
          workspace_path: options.projectObservation.workspacePath ?? options.workingDirectory,
          workspace_path_normalized: options.projectObservation.workspacePath ?? options.workingDirectory,
          repo_root: options.projectObservation.repoRoot,
          repo_fingerprint: options.projectObservation.repoFingerprint,
          confidence: 0.9,
        },
      },
    ],
    sessions: [
      {
        id: options.sessionId,
        source_id: sourceId,
        source_platform: options.platform,
        host_id: options.hostId,
        title: canonicalText,
        created_at: createdAt,
        updated_at: toolResultAt,
        turn_count: 1,
        model: "gpt-5",
        working_directory: options.workingDirectory,
        sync_axis: "current",
      },
    ],
    turns: [
      {
        id: options.turnId,
        revision_id: `${options.turnId}:r1`,
        user_messages: [
          {
            id: `${options.turnId}-user-message`,
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
        session_id: options.sessionId,
        source_id: sourceId,
        link_state: "unlinked",
        sync_axis: "current",
        value_axis: "active",
        retention_axis: "keep_raw_and_derived",
        context_ref: options.turnId,
        context_summary: {
          assistant_reply_count: 1,
          tool_call_count: 1,
          primary_model: "gpt-5",
          has_errors: false,
        },
        lineage: {
          atom_refs: [userAtomId, assistantAtomId, toolCallAtomId, toolResultAtomId],
          candidate_refs: [
            `${options.turnId}-candidate-submission`,
            `${options.turnId}-candidate-turn`,
            `${options.turnId}-candidate-context`,
            projectObservationCandidateId,
          ],
          fragment_refs: [userFragmentId, assistantFragmentId, toolCallFragmentId, toolResultFragmentId],
          record_refs: [recordId],
          blob_refs: [blobId],
        },
      },
    ],
    contexts: [
      {
        turn_id: options.turnId,
        system_messages: [],
        assistant_replies: [
          {
            id: `${options.turnId}-assistant-reply`,
            content: "Processing.",
            display_segments: [{ type: "text", content: "Processing." }],
            content_preview: "Processing.",
            model: "gpt-5",
            created_at: assistantAt,
            tool_call_ids: [`${options.turnId}-tool-call-projection`],
          },
        ],
        tool_calls: [
          {
            id: `${options.turnId}-tool-call-projection`,
            tool_name: "shell",
            input: {},
            input_summary: "{}",
            input_display_segments: [{ type: "text", content: "{}" }],
            output: "ok",
            output_preview: "ok",
            output_display_segments: [{ type: "text", content: "ok" }],
            status: "success",
            reply_id: `${options.turnId}-assistant-reply`,
            sequence: 0,
            created_at: toolCallAt,
          },
        ],
        raw_event_refs: [recordId],
      },
    ],
  };
}

function shiftIso(iso, seconds) {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
