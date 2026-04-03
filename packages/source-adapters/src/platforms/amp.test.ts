import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runSourceProbe } from "../index.js";
import { 
  seedSupportedSourceFixtures, 
  createSourceDefinition,
  getRepoMockDataRoot 
} from "../test-helpers.js";

test("[amp] root history jsonl stays out of default capture when scanning the source root", async () => {
  const mockDataRoot = getRepoMockDataRoot();
  const baseDir = path.join(mockDataRoot, ".local", "share", "amp");
  const source = createSourceDefinition("src-amp-root-mock-data", "amp", baseDir);

  const result = await runSourceProbe({ source_ids: [source.id] }, [source]);
  const payload = result.sources[0];
  assert.ok(payload);
  assert.equal(payload.source.sync_status, "healthy");
  assert.equal(payload.blobs.some((blob) => path.basename(blob.origin_path) === "history.jsonl"), false);
  assert.equal(payload.sessions.length, 1);
  assert.equal(payload.turns.length, 1);
});

test("runSourceProbe uses file mtime as session end when amp messages share one timestamp", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const ampDir = path.join(tempRoot, "amp");
    await mkdir(ampDir, { recursive: true });

    const sharedTimestamp = "2026-03-09T06:00:00.000Z";
    const sharedEpoch = new Date(sharedTimestamp).getTime();
    await writeFile(
      path.join(ampDir, "thread.json"),
      JSON.stringify({
        id: "amp-flat-1",
        created: sharedEpoch,
        title: "Flat AMP thread",
        env: { initial: { trees: [{ uri: "file:///workspace/amp-flat", displayName: "amp-flat" }] } },
        messages: [
          { meta: { sentAt: sharedEpoch }, role: "user", content: [{ type: "text", text: "Summarize." }] },
          { meta: { sentAt: sharedEpoch }, role: "assistant", content: [{ type: "text", text: "Here is the summary." }] },
        ],
      }),
      "utf8",
    );

    const fileMtime = new Date("2026-03-09T06:05:00.000Z");
    await utimes(path.join(ampDir, "thread.json"), fileMtime, fileMtime);

    const [payload] = (
      await runSourceProbe({ limit_files_per_source: 1 }, [
        createSourceDefinition("src-amp-flat", "amp", ampDir),
      ])
    ).sources;

    assert.ok(payload);
    assert.equal(payload.sessions.length, 1);
    const session = payload.sessions[0]!;
    assert.equal(session.created_at, sharedTimestamp);
    assert.equal(session.updated_at, fileMtime.toISOString());
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

