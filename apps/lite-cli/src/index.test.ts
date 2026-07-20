import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { formatTuiLaunchError, runLiteCli } from "./index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const codexRoot = path.join(repoRoot, "mock_data", ".codex", "sessions");

test("Lite CLI searches, reports stats, and writes one-way export", async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "cchistory-lite-cli-"));
  try {
    const rootArgs = ["--source-root", `codex=${codexRoot}`, "--safe", "--json"];
    const search = captureIo(tempHome);
    assert.equal(await runLiteCli(["search", "mock", ...rootArgs], search.io), 0);
    const searchPayload = JSON.parse(search.stdout.join("")) as {
      kind: string;
      total: number;
      results: Array<{ turn: { id: string } }>;
    };
    assert.equal(searchPayload.kind, "search");
    assert.ok(searchPayload.total > 0);

    const sources = captureIo(tempHome);
    assert.equal(await runLiteCli(["sources", ...rootArgs], sources.io), 0);
    const sourcesPayload = JSON.parse(sources.stdout.join("")) as {
      kind: string;
      total: number;
      sources: Array<{ id: string }>;
    };
    assert.equal(sourcesPayload.kind, "sources");
    assert.equal(sourcesPayload.total, 1);

    const sessions = captureIo(tempHome);
    assert.equal(await runLiteCli(["ls", "sessions", ...rootArgs], sessions.io), 0);
    const sessionsPayload = JSON.parse(sessions.stdout.join("")) as {
      kind: string;
      sessions: Array<{ id: string }>;
    };
    assert.equal(sessionsPayload.kind, "sessions");
    assert.ok(sessionsPayload.sessions.length > 0);

    const tree = captureIo(tempHome);
    assert.equal(await runLiteCli(["tree", "projects", ...rootArgs], tree.io), 0);
    assert.equal((JSON.parse(tree.stdout.join("")) as { kind: string }).kind, "project_tree");

    const turnDetail = captureIo(tempHome);
    assert.equal(
      await runLiteCli(["show", "turn", searchPayload.results[0]!.turn.id, ...rootArgs], turnDetail.io),
      0,
    );
    assert.equal((JSON.parse(turnDetail.stdout.join("")) as { kind: string }).kind, "turn_detail");

    const projects = captureIo(tempHome);
    assert.equal(await runLiteCli(["ls", "projects", ...rootArgs], projects.io), 0);
    const projectsPayload = JSON.parse(projects.stdout.join("")) as {
      kind: string;
      projects: Array<{ project_id: string }>;
    };
    assert.equal(projectsPayload.kind, "projects");
    const projectRef = projectsPayload.projects[0]?.project_id;
    assert.ok(projectRef);

    const projectDetail = captureIo(tempHome);
    assert.equal(await runLiteCli(["show", "project", projectRef, ...rootArgs], projectDetail.io), 0);
    assert.equal((JSON.parse(projectDetail.stdout.join("")) as { kind: string }).kind, "project_detail");

    const sourceId = sourcesPayload.sources[0]?.id;
    assert.ok(sourceId);
    const sourceDetail = captureIo(tempHome);
    assert.equal(await runLiteCli(["show", "source", sourceId, ...rootArgs], sourceDetail.io), 0);
    assert.equal((JSON.parse(sourceDetail.stdout.join("")) as { kind: string }).kind, "source_detail");

    const unknownProject = captureIo(tempHome);
    assert.equal(await runLiteCli(["show", "project", "no-such-project", ...rootArgs], unknownProject.io), 2);
    assert.match(unknownProject.stderr.join(""), /Project not found: no-such-project/);

    const invalidShowTarget = captureIo(tempHome);
    assert.equal(await runLiteCli(["show", "blob", projectRef, ...rootArgs], invalidShowTarget.io), 2);
    assert.match(invalidShowTarget.stderr.join(""), /show target must be project, session, turn, or source/);

    const stats = captureIo(tempHome);
    assert.equal(await runLiteCli(["stats", ...rootArgs], stats.io), 0);
    const statsPayload = JSON.parse(stats.stdout.join("")) as { kind: string; overview: { total_turns: number } };
    assert.equal(statsPayload.kind, "stats");
    assert.ok(statsPayload.overview.total_turns > 0);

    const rollup = captureIo(tempHome);
    assert.equal(await runLiteCli(["stats", "--by", "source", ...rootArgs], rollup.io), 0);
    const rollupPayload = JSON.parse(rollup.stdout.join("")) as { rollup: { dimension: string } };
    assert.equal(rollupPayload.rollup.dimension, "source");

    const outFile = path.join(tempHome, "lite-export.jsonl");
    const exported = captureIo(tempHome);
    assert.equal(
      await runLiteCli(["export", "--format", "jsonl", "--out", outFile, ...rootArgs], exported.io),
      0,
    );
    const firstLine = (await readFile(outFile, "utf8")).split("\n")[0];
    assert.deepEqual(JSON.parse(firstLine ?? "{}"), {
      schema: "cchistory-lite-export/v1",
      kind: "manifest",
    });

    const jsonExport = captureIo(tempHome);
    assert.equal(
      await runLiteCli(["export", "--format", "json", "--out", "-", ...rootArgs], jsonExport.io),
      0,
    );
    assert.equal((JSON.parse(jsonExport.stdout.join("")) as { schema: string }).schema, "cchistory-lite-export/v1");

    const markdownExport = captureIo(tempHome);
    assert.equal(
      await runLiteCli(["export", "--format", "markdown", "--out", "-", ...rootArgs], markdownExport.io),
      0,
    );
    assert.match(markdownExport.stdout.join(""), /One-way canonical export/);

    const invalid = captureIo(tempHome);
    assert.equal(await runLiteCli(["stats", "--store", path.join(tempHome, ".cchistory")], invalid.io), 2);
    assert.match(invalid.stderr.join(""), /does not accept --store or --db/);

    const forbidden = captureIo(tempHome);
    assert.equal(await runLiteCli(["import", "anything"], forbidden.io), 2);
    assert.match(forbidden.stderr.join(""), /not available in CC History Lite/);

    const missingEquals = captureIo(tempHome);
    assert.equal(await runLiteCli(["sources", "--source-root", "codex"], missingEquals.io), 2);
    assert.match(missingEquals.stderr.join(""), /--source-root must use <slot-or-id>=<path>/);

    const emptySlot = captureIo(tempHome);
    assert.equal(await runLiteCli(["sources", "--source-root", "=/tmp/never-probed"], emptySlot.io), 2);
    assert.match(emptySlot.stderr.join(""), /--source-root must use <slot-or-id>=<path>/);

    const emptyPath = captureIo(tempHome);
    assert.equal(await runLiteCli(["sources", "--source-root", "codex="], emptyPath.io), 2);
    assert.match(emptyPath.stderr.join(""), /--source-root must use <slot-or-id>=<path>/);

    const rejectedFullRoot = captureIo(tempHome);
    assert.equal(
      await runLiteCli(
        ["sources", "--source-root", `codex=${path.join(tempHome, ".cchistory")}`, "--json"],
        rejectedFullRoot.io,
      ),
      1,
    );
    assert.match(rejectedFullRoot.stderr.join(""), /Full store paths are not Lite sources/);

    const rejectedExport = captureIo(tempHome);
    assert.equal(
      await runLiteCli(
        ["export", "--out", path.join(tempHome, ".cchistory", "lite.jsonl"), ...rootArgs],
        rejectedExport.io,
      ),
      2,
    );
    assert.match(rejectedExport.stderr.join(""), /cannot write into a Full store path/);

    const sourceOutput = path.join(codexRoot, "must-not-write-lite-export.jsonl");
    const rejectedSourceOutput = captureIo(tempHome);
    assert.equal(
      await runLiteCli(["export", "--out", sourceOutput, ...rootArgs], rejectedSourceOutput.io),
      2,
    );
    assert.match(rejectedSourceOutput.stderr.join(""), /outside native source roots/);
    await assert.rejects(access(sourceOutput));

    let launchedArgs: string[] | undefined;
    const launched = captureIo(tempHome, async (args) => {
      launchedArgs = args;
      return 0;
    });
    assert.equal(await runLiteCli(["tui", ...rootArgs], launched.io), 0);
    assert.deepEqual(launchedArgs, ["--source-root", `codex=${codexRoot}`, "--safe"]);

    await assert.rejects(access(path.join(tempHome, ".cchistory")));
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test("Lite CLI rejects empty inline flag values and non-positive search limits", async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "cchistory-lite-cli-flags-"));
  try {
    const rootArgs = ["--source-root", `codex=${codexRoot}`, "--safe", "--json"];

    const emptyInline = captureIo(tempHome);
    assert.equal(await runLiteCli(["search", "mock", "--project=", ...rootArgs], emptyInline.io), 2);
    assert.match(emptyInline.stderr.join(""), /--project requires a value/);

    const zeroLimit = captureIo(tempHome);
    assert.equal(await runLiteCli(["search", "mock", "--limit", "0", ...rootArgs], zeroLimit.io), 2);
    assert.match(zeroLimit.stderr.join(""), /--limit must be an integer >= 1/);

    const emptyLimitInline = captureIo(tempHome);
    assert.equal(await runLiteCli(["search", "mock", "--limit=", ...rootArgs], emptyLimitInline.io), 2);
    assert.match(emptyLimitInline.stderr.join(""), /--limit requires a value/);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test("Lite CLI resolves export paths before writing through symlinks", async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "cchistory-lite-cli-export-paths-"));
  const nativeSource = path.join(tempHome, "native-source");
  const nativeSourceAlias = path.join(tempHome, "native-source-alias");
  const fullStoreTarget = path.join(tempHome, "full-store-target");
  try {
    await mkdir(nativeSource);
    await symlink(nativeSource, nativeSourceAlias, "dir");
    await mkdir(fullStoreTarget);
    await symlink(fullStoreTarget, path.join(tempHome, ".cchistory"), "dir");

    const rootArgs = ["--source-root", `codex=${nativeSource}`, "--safe"];
    const sourceOutput = path.join(nativeSourceAlias, "must-not-write.jsonl");
    const rejectedSourceOutput = captureIo(tempHome);
    assert.equal(
      await runLiteCli(["export", "--out", sourceOutput, ...rootArgs], rejectedSourceOutput.io),
      2,
    );
    assert.match(rejectedSourceOutput.stderr.join(""), /outside native source roots/);
    await assert.rejects(access(path.join(nativeSource, "must-not-write.jsonl")));

    const fullOutput = path.join(fullStoreTarget, "must-not-write.jsonl");
    const rejectedFullOutput = captureIo(tempHome);
    assert.equal(
      await runLiteCli(["export", "--out", fullOutput, ...rootArgs], rejectedFullOutput.io),
      2,
    );
    assert.match(rejectedFullOutput.stderr.join(""), /cannot write into a Full store path/);
    await assert.rejects(access(fullOutput));

    const existingTarget = path.join(tempHome, "existing-target.jsonl");
    const outputAlias = path.join(tempHome, "output-alias.jsonl");
    await writeFile(existingTarget, "preserve me", "utf8");
    await symlink(existingTarget, outputAlias, "file");
    const rejectedOutputAlias = captureIo(tempHome);
    assert.equal(
      await runLiteCli(["export", "--out", outputAlias, ...rootArgs], rejectedOutputAlias.io),
      2,
    );
    assert.match(rejectedOutputAlias.stderr.join(""), /cannot be a symbolic link/);
    assert.equal(await readFile(existingTarget, "utf8"), "preserve me");
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test("Lite CLI export rejects destinations whose parent is a symlink into a Full store or source root", async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "cchistory-lite-cli-export-parents-"));
  const nativeSource = path.join(tempHome, "native-source");
  const exportDir = path.join(tempHome, "exports");
  const sourceAliasDir = path.join(tempHome, "source-alias");
  try {
    await mkdir(nativeSource);
    await mkdir(path.join(tempHome, ".cchistory"));
    // exportDir is a symlink to ~/.cchistory (the Full store). Output paths
    // inside exportDir must be rejected even when the file itself doesn't
    // exist yet — resolvePathForContainment must walk up to detect this.
    await symlink(path.join(tempHome, ".cchistory"), exportDir, "dir");
    await symlink(nativeSource, sourceAliasDir, "dir");

    const rootArgs = ["--source-root", `codex=${nativeSource}`, "--safe"];

    const outputUnderFullStore = path.join(exportDir, "subdir", "lite.jsonl");
    const rejectedFullParent = captureIo(tempHome);
    assert.equal(
      await runLiteCli(["export", "--out", outputUnderFullStore, ...rootArgs], rejectedFullParent.io),
      2,
    );
    assert.match(rejectedFullParent.stderr.join(""), /cannot write into a Full store path/);
    await assert.rejects(access(path.join(tempHome, ".cchistory", "subdir", "lite.jsonl")));

    const outputUnderSource = path.join(sourceAliasDir, "deep", "lite.jsonl");
    const rejectedSourceParent = captureIo(tempHome);
    assert.equal(
      await runLiteCli(["export", "--out", outputUnderSource, ...rootArgs], rejectedSourceParent.io),
      2,
    );
    assert.match(rejectedSourceParent.stderr.join(""), /outside native source roots/);
    await assert.rejects(access(path.join(nativeSource, "deep", "lite.jsonl")));
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test("Lite CLI launchTui error formatter hints at lite:tui:link on ENOENT", () => {
  const enoent = Object.assign(new Error("spawn cchistory-lite-tui ENOENT"), { code: "ENOENT" as const });
  const enoentMessage = formatTuiLaunchError(enoent);
  assert.match(enoentMessage, /Unable to launch cchistory-lite-tui:/);
  assert.match(enoentMessage, /pnpm run lite:tui:link/);

  const eacces = Object.assign(new Error("spawn EACCES"), { code: "EACCES" as const });
  const eaccesMessage = formatTuiLaunchError(eacces);
  assert.match(eaccesMessage, /Unable to launch cchistory-lite-tui:/);
  assert.doesNotMatch(eaccesMessage, /lite:tui:link/);

  const plain = new Error("network down");
  assert.match(formatTuiLaunchError(plain), /network down/);
});

function captureIo(cwd: string, spawnTui?: (args: string[]) => Promise<number>) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      cwd,
      homeDir: cwd,
      hostname: "cchistory-lite-test-host",
      stdout: (value: string) => stdout.push(value),
      stderr: (value: string) => stderr.push(value),
      isTTY: false,
      spawnTui,
    },
  };
}
