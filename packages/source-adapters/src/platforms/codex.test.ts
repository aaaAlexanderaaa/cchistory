import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runSourceProbe } from "../index.js";
import { 
  seedSupportedSourceFixtures 
} from "../test-helpers.js";

test("[codex] root history jsonl stays out of default capture when scanning the source root", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const sources = await seedSupportedSourceFixtures(tempRoot);
    const codexSource = sources.find((source) => source.platform === "codex");
    assert.ok(codexSource);

    const result = await runSourceProbe({ source_ids: [codexSource.id] }, [codexSource]);
    const payload = result.sources[0];
    assert.ok(payload);
    assert.equal(payload.source.sync_status, "healthy");
    assert.equal(payload.blobs.some((blob) => path.basename(blob.origin_path) === "session.jsonl"), false);
    assert.equal(payload.sessions.length, 1);
    assert.equal(payload.turns.length, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
