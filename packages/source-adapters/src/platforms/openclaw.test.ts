import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runSourceProbe } from "../index.js";
import { 
  getRepoMockDataRoot, 
  createSourceDefinition, 
  assertFragmentKinds 
} from "../test-helpers.js";

test("[openclaw] sanitized real-archive fixtures keep cron-trigger prompts as automation evidence instead of canonical turns", async () => {
  const mockDataRoot = getRepoMockDataRoot();
  const baseDir = path.join(mockDataRoot, "Library", "Application Support", "openclaw");
  const source = createSourceDefinition("src-openclaw-mock-data", "openclaw", baseDir);

  const result = await runSourceProbe({ source_ids: [source.id] }, [source]);
  const payload = result.sources[0];
  assert.ok(payload);
  assert.equal(payload.source.sync_status, "healthy");
  assert.equal(payload.sessions.length, 3);
  assert.equal(payload.turns.length, 0);

  const mainSession = payload.sessions.find((session) => session.working_directory === "/Users/mock_user/workspace/openclaw-automation");
  const cronRunSession = payload.sessions.find((session) => session.title === "cron:mock-openclaw-hourly");
  assert.equal(mainSession?.turn_count, 0);
  assert.ok(cronRunSession);
  assert.equal(cronRunSession?.turn_count, 0);
  assert.ok(
    payload.atoms.some(
      (atom) => atom.origin_kind === "automation_trigger" && String(atom.payload.text ?? "").includes("[cron:mock-openclaw-hourly]"),
    ),
  );
  assert.ok(
    payload.fragments.some(
      (fragment) =>
        fragment.session_ref === cronRunSession?.id &&
        fragment.fragment_kind === "session_relation" &&
        String(fragment.payload.parent_uuid ?? "") === "11111111-2222-4333-8444-555555555555" &&
        String(fragment.payload.session_key ?? "") === "main:11111111-2222-4333-8444-555555555555",
    ),
  );
  assert.ok(
    payload.fragments.some(
      (fragment) =>
        fragment.session_ref === cronRunSession?.id &&
        fragment.fragment_kind === "text" &&
        fragment.payload.origin_kind === "source_meta" &&
        String(fragment.payload.text ?? "").includes("Reviewed queued rule updates"),
    ),
  );
  assertFragmentKinds(payload, ["workspace_signal", "model_signal", "title_signal", "session_relation", "text", "tool_call", "tool_result"]);

  const blobPaths = payload.blobs.map((blob) => blob.origin_path);
  assert.equal(
    blobPaths.includes(path.join(baseDir, "main", "sessions", "22222222-3333-4444-8555-666666666666.jsonl.reset.2026-04-01T00-10-00.000Z")),
    true,
  );
  assert.equal(
    blobPaths.includes(path.join(baseDir, "main", "sessions", "33333333-4444-4555-8666-777777777777.jsonl.deleted.2026-04-01T00-20-00.000Z")),
    true,
  );
  assert.equal(blobPaths.includes(path.join(baseDir, "main", "agent", "auth-profiles.json")), true);
  assert.equal(blobPaths.includes(path.join(baseDir, "main", "agent", "models.json")), true);
  assert.equal(blobPaths.includes(path.join(baseDir, "anyrouter", "agent", "auth-profiles.json")), true);
  assert.equal(blobPaths.includes(path.join(baseDir, "kimicoding", "agent", "auth-profiles.json")), true);
});
