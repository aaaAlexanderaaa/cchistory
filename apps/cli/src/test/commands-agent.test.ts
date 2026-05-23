import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runCliCapture, seedCliFixtures } from "./helpers.js";

interface MockRequest {
  method: string;
  url: string;
  body: any;
}

test("agent pair initializes remote agent link", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-agent-pair-"));
  const statePath = path.join(tempRoot, "agent-state.json");
  const server = await startMockRemoteAgentServer((request) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/api/agent/pair");
    assert.equal(request.body.pairing_token, "pair-secret");
    assert.equal(request.body.display_name, "local-agent");
    assert.equal(request.body.reported_hostname, "test-host");
    return {
      agent_id: "agent-test-1",
      agent_token: "agent-token-1",
      paired_at: "2026-05-15T00:00:00.000Z",
    };
  });

  try {
    const result = await runCliCapture(
      [
        "agent", "pair",
        "--server", server.url,
        "--pair-token", "pair-secret",
        "--display-name", "local-agent",
        "--reported-hostname", "test-host",
        "--state-file", statePath,
      ],
      tempRoot,
    );

    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /Paired remote agent agent-test-1/);
    assert.match(result.stdout, new RegExp(escapeRegExp(statePath)));

    const state = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(state.version, 1);
    assert.equal(state.server_url, server.url);
    assert.equal(state.agent_id, "agent-test-1");
    assert.equal(state.agent_token, "agent-token-1");
    assert.deepEqual(state.last_uploaded_generation_by_source_id, {});
  } finally {
    await server.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("agent pull leases a remote job and uploads a mockable local bundle", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-agent-pull-"));
  const statePath = path.join(tempRoot, "agent-state.json");
  const originalHome = process.env.HOME;
  const completedJobs: unknown[] = [];
  const uploads: MockRequest[] = [];
  const server = await startMockRemoteAgentServer((request) => {
    if (request.url === "/api/agent/pair") {
      return {
        agent_id: "agent-test-1",
        agent_token: "agent-token-1",
        paired_at: "2026-05-15T00:00:00.000Z",
      };
    }
    if (request.url === "/api/agent/jobs/lease") {
      assert.equal(request.body.agent_id, "agent-test-1");
      assert.equal(request.body.agent_token, "agent-token-1");
      return {
        agent_id: "agent-test-1",
        job: {
          job_id: "job-test-1",
          trigger_kind: "server_requested",
          selector: { kind: "agent_ids", agent_ids: ["agent-test-1"] },
          source_slots: ["codex"],
          sync_mode: "force_snapshot",
          limit_files_per_source: 1,
          created_at: "2026-05-15T00:00:01.000Z",
          leased_at: "2026-05-15T00:00:02.000Z",
          lease_expires_at: "2026-05-15T00:05:02.000Z",
        },
      };
    }
    if (request.url === "/api/agent/uploads") {
      uploads.push(request);
      assert.equal(request.body.agent_id, "agent-test-1");
      assert.equal(request.body.agent_token, "agent-token-1");
      assert.equal(request.body.job_id, "job-test-1");
      assert.ok(Array.isArray(request.body.source_manifest));
      assert.ok(request.body.source_manifest.some((entry: any) => entry.slot_id === "codex" && entry.included_in_bundle));
      const includedEntries = request.body.source_manifest.filter((entry: any) => entry.included_in_bundle);
      return {
        bundle_id: "bundle-test-1",
        imported_source_ids: includedEntries.map((entry: any) => entry.source_id),
        replaced_source_ids: [],
        skipped_source_ids: [],
        source_manifest_count: request.body.source_manifest.length,
        accepted_generations: Object.fromEntries(includedEntries.map((entry: any) => [entry.source_id, entry.generation])),
      };
    }
    if (request.url === "/api/agent/jobs/job-test-1/complete") {
      completedJobs.push(request.body);
      assert.equal(request.body.agent_id, "agent-test-1");
      assert.equal(request.body.agent_token, "agent-token-1");
      assert.equal(request.body.status, "succeeded");
      assert.equal(request.body.bundle_id, "bundle-test-1");
      return {
        job_id: "job-test-1",
        agent_id: "agent-test-1",
        status: "succeeded",
        completed_at: "2026-05-15T00:00:03.000Z",
      };
    }
    return { error: `Unexpected request ${request.method} ${request.url}` };
  });

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;

    const pairResult = await runCliCapture(
      ["agent", "pair", "--server", server.url, "--pair-token", "pair-secret", "--state-file", statePath],
      tempRoot,
    );
    assert.equal(pairResult.exitCode, 0, pairResult.stderr);

    const pullResult = await runCliCapture(["agent", "pull", "--state-file", statePath], tempRoot);
    assert.equal(pullResult.exitCode, 0, pullResult.stderr);
    assert.match(pullResult.stdout, /Completed leased remote-agent job job-test-1/);
    assert.match(pullResult.stdout, /Bundle: bundle-test-1/);
    assert.equal(uploads.length, 1);
    assert.equal(completedJobs.length, 1);

    const state = JSON.parse(await readFile(statePath, "utf8"));
    assert.ok(Object.values(state.last_uploaded_generation_by_source_id).some((value) => value === 1));
    assert.ok(Object.values(state.last_uploaded_checksum_by_source_id).some((value) => typeof value === "string" && value.length > 0));
  } finally {
    process.env.HOME = originalHome;
    await server.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("agent upload and pull explain missing pairing state before remote access", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-agent-missing-state-"));
  const missingStatePath = path.join(tempRoot, "missing-agent-state.json");

  try {
    for (const argv of [
      ["agent", "upload", "--state-file", missingStatePath],
      ["agent", "pull", "--state-file", missingStatePath],
    ]) {
      const result = await runCliCapture(argv, tempRoot);
      assert.equal(result.exitCode, 1, argv.join(" "));
      assert.equal(result.stdout, "", argv.join(" "));
      assert.match(result.stderr, /Remote agent state file not found:/);
      assert.match(result.stderr, /cchistory agent pair --server <url> --pair-token <token>/);
      assert.doesNotMatch(result.stderr, /ENOENT|fetch failed|ECONNREFUSED/);
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function startMockRemoteAgentServer(handler: (request: MockRequest) => unknown): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const server = http.createServer(async (request, response) => {
    try {
      const body = await readJsonBody(request);
      const payload = handler({ method: request.method ?? "GET", url: request.url ?? "/", body });
      sendJson(response, 200, payload);
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

async function readJsonBody(request: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.length > 0 ? JSON.parse(raw) : {};
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
