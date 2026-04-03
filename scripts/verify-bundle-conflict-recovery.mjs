import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createApiRuntime } from "../apps/api/dist/app.js";
import { CCHistoryStorage } from "../packages/storage/dist/index.js";
import { computePayloadChecksum } from "../apps/cli/dist/bundle.js";
import { runCli } from "../apps/cli/dist/index.js";
import { seedAcceptanceStore } from "./verify-v1-seeded-acceptance.mjs";

async function main() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-bundle-conflict-"));

  try {
    const sourceStoreDir = path.join(tempRoot, "source-store");
    const targetStoreDir = path.join(tempRoot, "target-store");
    const bundleADir = path.join(tempRoot, "bundle-a.cchistory-bundle");
    const bundleBDir = path.join(tempRoot, "bundle-b.cchistory-bundle");
    const seeded = seedAcceptanceStore(sourceStoreDir);
    const sourceStorage = new CCHistoryStorage(sourceStoreDir);
    const ampSourceId = sourceStorage.listSources().find((source) => source.platform === "amp")?.id;
    sourceStorage.close();
    assert.ok(ampSourceId, "expected one seeded AMP source for conflict verification");

    const exportResult = await runCliCapture(["export", "--store", sourceStoreDir, "--source", ampSourceId, "--out", bundleADir], tempRoot);
    assert.equal(exportResult.exitCode, 0, exportResult.stderr);

    const firstImport = await runCliJson(["import", bundleADir, "--store", targetStoreDir], tempRoot);
    assert.equal(firstImport.kind, "import");
    assert.equal(firstImport.imported_source_ids.length, 1);
    assert.equal(firstImport.replaced_source_ids.length, 0);
    assert.equal(firstImport.skipped_source_ids.length, 0);
    assert.equal(firstImport.project_count_after, 1);

    const mutation = await createConflictBundle(bundleADir, bundleBDir);

    const defaultConflict = await runCliCapture(["import", bundleBDir, "--store", targetStoreDir], tempRoot);
    assert.notEqual(defaultConflict.exitCode, 0, "default conflict import should fail");
    assert.match(defaultConflict.stderr, /Source conflict detected/);
    assert.match(defaultConflict.stderr, new RegExp(mutation.sourceId));
    await verifyApiTurn(targetStoreDir, seeded.targetTurn.id, /Alpha traceability target/);

    const dryRunError = await runCliJson(["import", bundleBDir, "--store", targetStoreDir, "--dry-run"], tempRoot);
    assert.equal(dryRunError.kind, "import-dry-run");
    assert.equal(dryRunError.target_exists, true);
    assert.equal(dryRunError.would_fail, true);
    assert.deepEqual(dryRunError.conflicting_source_ids, [mutation.sourceId]);
    assert.ok(
      dryRunError.source_plans.some((entry) => entry.source_id === mutation.sourceId && entry.reason === "conflict_error"),
      "dry-run error plan should classify the changed source as conflict_error",
    );

    const dryRunReplace = await runCliJson(
      ["import", bundleBDir, "--store", targetStoreDir, "--dry-run", "--on-conflict", "replace"],
      tempRoot,
    );
    assert.equal(dryRunReplace.kind, "import-dry-run");
    assert.equal(dryRunReplace.would_fail, false);
    assert.deepEqual(dryRunReplace.replaced_source_ids, [mutation.sourceId]);
    assert.ok(
      dryRunReplace.source_plans.some((entry) => entry.source_id === mutation.sourceId && entry.reason === "conflict_replace"),
      "dry-run replace plan should classify the changed source as conflict_replace",
    );

    const skipResult = await runCliJson(["import", bundleBDir, "--store", targetStoreDir, "--on-conflict", "skip"], tempRoot);
    assert.equal(skipResult.kind, "import");
    assert.equal(skipResult.imported_source_ids.length, 0);
    assert.equal(skipResult.replaced_source_ids.length, 0);
    assert.ok(skipResult.skipped_source_ids.includes(mutation.sourceId));
    assert.ok(
      skipResult.source_plans.some((entry) => entry.source_id === mutation.sourceId && entry.reason === "conflict_skip"),
      "skip import should classify the changed source as conflict_skip",
    );
    await verifyApiTurn(targetStoreDir, seeded.targetTurn.id, /Alpha traceability target/);

    const replaceResult = await runCliJson(["import", bundleBDir, "--store", targetStoreDir, "--on-conflict", "replace"], tempRoot);
    assert.equal(replaceResult.kind, "import");
    assert.deepEqual(replaceResult.replaced_source_ids, [mutation.sourceId]);
    assert.equal(replaceResult.project_count_after, 1);

    const restoreCheck = await runCliJson(["restore-check", "--store", targetStoreDir], tempRoot);
    assert.equal(restoreCheck.kind, "restore-check");
    assert.equal(restoreCheck.read_mode, "index");
    assert.equal(restoreCheck.stats.counts.sources, 1);

    const searchResult = await runCliJson(["search", mutation.replacementText, "--store", targetStoreDir], tempRoot);
    assert.equal(searchResult.kind, "search");
    assert.ok(searchResult.results.some((entry) => entry.turn.id === seeded.targetTurn.id));

    await verifyApiTurn(targetStoreDir, seeded.targetTurn.id, new RegExp(mutation.replacementText));

    console.log(
      `Bundle conflict recovery verifier passed for ${seeded.project.display_name} (${seeded.project.project_id}) via ${mutation.sourceId}.`,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function createConflictBundle(sourceBundleDir, targetBundleDir) {
  await cp(sourceBundleDir, targetBundleDir, { recursive: true });

  const manifestPath = path.join(targetBundleDir, "manifest.json");
  const checksumsPath = path.join(targetBundleDir, "checksums.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const checksums = JSON.parse(await readFile(checksumsPath, "utf8"));

  let mutatedSourceId;
  const replacementText = "Alpha traceability target replaced by bundle conflict verifier";

  for (const sourceId of manifest.source_instance_ids) {
    const payloadPath = path.join(targetBundleDir, "payloads", `${sourceId}.json`);
    const payload = JSON.parse(await readFile(payloadPath, "utf8"));
    if (payload.source.platform !== "amp") {
      continue;
    }

    mutatePayloadText(payload, replacementText);
    await writeFile(payloadPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    checksums.payload_sha256_by_source_id[sourceId] = computePayloadChecksum(payload);
    mutatedSourceId = sourceId;
    break;
  }

  assert.ok(mutatedSourceId, "expected to mutate one AMP payload in the copied bundle");

  const exportedAt = new Date().toISOString();
  manifest.exported_at = exportedAt;
  manifest.bundle_id = `bundle-${sha256(JSON.stringify({ exportedAt, payloadChecksums: checksums.payload_sha256_by_source_id })).slice(0, 12)}`;
  const manifestJson = JSON.stringify(manifest, null, 2);
  checksums.manifest_sha256 = sha256(manifestJson);

  await writeFile(manifestPath, manifestJson, "utf8");
  await writeFile(checksumsPath, `${JSON.stringify(checksums, null, 2)}\n`, "utf8");

  return {
    sourceId: mutatedSourceId,
    replacementText,
  };
}

function mutatePayloadText(payload, replacementText) {
  for (const turn of payload.turns ?? []) {
    if (turn.id === "turn-alpha-amp") {
      turn.raw_text = replacementText;
      turn.canonical_text = replacementText;
      if (Array.isArray(turn.user_messages) && turn.user_messages[0]) {
        turn.user_messages[0].raw_text = replacementText;
      }
      if (Array.isArray(turn.display_segments) && turn.display_segments[0]) {
        turn.display_segments[0].content = replacementText;
      }
    }
  }

  for (const atom of payload.atoms ?? []) {
    if (atom.id === "turn-alpha-amp-atom-user" && atom.payload) {
      atom.payload.text = replacementText;
    }
  }

  for (const fragment of payload.fragments ?? []) {
    if (fragment.id === "turn-alpha-amp-fragment-user" && fragment.payload) {
      fragment.payload.text = replacementText;
    }
  }
}

async function verifyApiTurn(storeDir, turnId, pattern) {
  const runtime = await createApiRuntime({ dataDir: storeDir, sources: [] });
  try {
    const response = await runtime.app.inject({ method: "GET", url: `/api/turns/${turnId}` });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.match(body.turn.canonical_text, pattern);
  } finally {
    await runtime.app.close();
    runtime.storage.close();
  }
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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

await main();
