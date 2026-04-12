import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { SourceSyncPayload } from "@cchistory/domain";
import { CCHistoryStorage } from "@cchistory/storage";
import { exportBundle, importBundleIntoStore } from "../bundle.js";
import { createLegacySchemaFixturePayload } from "./helpers.js";

function rewritePayloadIds(payload: SourceSyncPayload, replacements: Record<string, string>): SourceSyncPayload {
  let serialized = JSON.stringify(payload);
  for (const [from, to] of Object.entries(replacements)) {
    serialized = serialized.split(from).join(to);
  }
  return JSON.parse(serialized) as SourceSyncPayload;
}

test("importBundleIntoStore does not partially import when a later payload is corrupted", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-bundle-atomicity-"));
  const sourceStorage = new CCHistoryStorage({ dbPath: path.join(tempRoot, "source.sqlite") });
  const targetStorage = new CCHistoryStorage({ dbPath: path.join(tempRoot, "target.sqlite") });

  try {
    const payloadA = rewritePayloadIds(createLegacySchemaFixturePayload(), {
      "src-cli-legacy-search": "src-a",
      "host-cli-legacy-search": "host-a",
      "session-cli-legacy-search": "session-a",
      "turn-cli-legacy-search": "turn-a",
      "message-cli-legacy-user": "message-a-user",
      "reply-cli-legacy-assistant": "reply-a-assistant",
      "atom-cli-legacy-user": "atom-a-user",
      "atom-cli-legacy-assistant": "atom-a-assistant",
      "atom-cli-legacy-tool-call": "atom-a-tool-call",
      "atom-cli-legacy-tool-result": "atom-a-tool-result",
      "edge-cli-legacy-1": "edge-a-1",
      "edge-cli-legacy-2": "edge-a-2",
      "call-cli-legacy": "call-a",
      "sr-1": "sr-a",
      "Legacy claw search": "Bundle source A",
      "/tmp/cli-legacy-search": "/tmp/source-a",
      "/workspace/legacy-claw": "/workspace/source-a",
    });
    const payloadB = rewritePayloadIds(createLegacySchemaFixturePayload(), {
      "src-cli-legacy-search": "src-b",
      "host-cli-legacy-search": "host-b",
      "session-cli-legacy-search": "session-b",
      "turn-cli-legacy-search": "turn-b",
      "message-cli-legacy-user": "message-b-user",
      "reply-cli-legacy-assistant": "reply-b-assistant",
      "atom-cli-legacy-user": "atom-b-user",
      "atom-cli-legacy-assistant": "atom-b-assistant",
      "atom-cli-legacy-tool-call": "atom-b-tool-call",
      "atom-cli-legacy-tool-result": "atom-b-tool-result",
      "edge-cli-legacy-1": "edge-b-1",
      "edge-cli-legacy-2": "edge-b-2",
      "call-cli-legacy": "call-b",
      "sr-1": "sr-b",
      "Legacy claw search": "Bundle source B",
      "/tmp/cli-legacy-search": "/tmp/source-b",
      "/workspace/legacy-claw": "/workspace/source-b",
    });

    sourceStorage.replaceSourcePayload(payloadA);
    sourceStorage.replaceSourcePayload(payloadB);

    const bundleDir = path.join(tempRoot, "bundle");
    const exportResult = await exportBundle({
      storage: sourceStorage,
      bundleDir,
      includeRawBlobs: false,
    });

    const brokenSourceId = exportResult.manifest.source_instance_ids.at(-1);
    assert.ok(brokenSourceId, "expected exported bundle to contain at least one source");
    const brokenPayloadPath = path.join(bundleDir, "payloads", `${brokenSourceId}.json`);
    const brokenPayloadJson = await readFile(brokenPayloadPath, "utf8");
    await writeFile(brokenPayloadPath, `${brokenPayloadJson}\n`, "utf8");

    await assert.rejects(
      importBundleIntoStore({
        storage: targetStorage,
        bundleDir,
        rawDir: path.join(tempRoot, "raw"),
        onConflict: "error",
      }),
      /Payload checksum mismatch/,
    );

    assert.equal(targetStorage.listSources().length, 0, "target store should remain unchanged on failed import");
    assert.equal(targetStorage.getImportedBundle(exportResult.manifest.bundle_id), undefined);
    assert.equal(targetStorage.listProjects().length, 0, "failed import should not create linked projects");
  } finally {
    sourceStorage.close();
    targetStorage.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
