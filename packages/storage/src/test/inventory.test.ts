import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { CCHistoryStorage, readStorageFootprintInventory } from "../index.js";
import { createFixturePayload } from "./helpers.js";

test("storage footprint inventory reports a missing store without creating files", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-inventory-missing-"));
  try {
    const dbPath = path.join(tempRoot, "missing-store", "cchistory.sqlite");
    const inventory = await readStorageFootprintInventory({ dbPath });

    assert.equal(inventory.status, "missing");
    assert.equal(inventory.sqlite_files.main.exists, false);
    assert.equal(inventory.evidence_store.status, "missing");
    assert.equal(inventory.evidence_store.file_count, 0);
    assert.equal(inventory.evidence_store.total_bytes, 0);
    assert.equal(inventory.tables.length, 0);
    assert.equal(inventory.totals.row_count, 0);
    assert.equal(inventory.totals.evidence_store_files, 0);
    assert.equal(inventory.totals.evidence_store_bytes, 0);
    await assert.rejects(access(dbPath));
    await assert.rejects(access(path.dirname(dbPath)));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("storage footprint inventory reports rows, payload bytes, largest rows, SQLite files, search state, and source roots", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-inventory-"));
  try {
    const sourceRoot = path.join(tempRoot, "source-root");
    await mkdir(path.join(sourceRoot, "nested"), { recursive: true });
    await writeFile(path.join(sourceRoot, "session.jsonl"), "first line\nsecond line\n", "utf8");
    await writeFile(path.join(sourceRoot, "nested", "companion.json"), "{\"ok\":true}\n", "utf8");

    const storage = new CCHistoryStorage({ dbPath: path.join(tempRoot, "store", "cchistory.sqlite") });
    const payload = createFixturePayload("src-inventory", "Inventory asks should be measurable", "stage-inventory", {
      baseDir: sourceRoot,
      sessionId: "session-inventory",
      turnId: "turn-inventory",
    });
    payload.contexts[0]!.tool_calls[0]!.output = "large tool output ".repeat(64);
    storage.replaceSourcePayload(payload);
    storage.close();

    const inventory = await readStorageFootprintInventory({
      dbPath: path.join(tempRoot, "store", "cchistory.sqlite"),
      largestRowsLimit: 2,
    });

    assert.equal(inventory.status, "ok");
    assert.equal(inventory.sqlite_files.main.exists, true);
    assert.ok(inventory.sqlite_files.main.size_bytes > 0);
    assert.equal(typeof inventory.search_index.table_exists, "boolean");
    assert.ok(Array.isArray(inventory.search_index.shadow_tables));
    assert.equal(inventory.evidence_store.status, "ok");
    assert.ok(inventory.evidence_store.file_count > 0);
    assert.ok(inventory.evidence_store.total_bytes > 0);

    // B.6: V1 user_turns and turn_contexts are gone entirely — schema no
    // longer creates them, and `migration compact` drops any pre-existing
    // copies on legacy stores. The inventory must not list them at all.
    const turnsTable = inventory.tables.find((table) => table.name === "user_turns");
    assert.equal(turnsTable, undefined, "B.6: V1 user_turns is no longer in the schema");

    const contextsTable = inventory.tables.find((table) => table.name === "turn_contexts");
    assert.equal(contextsTable, undefined, "B.6: V1 turn_contexts is no longer in the schema");

    const turnsV2Table = inventory.tables.find((table) => table.name === "user_turns_v2");
    assert.equal(turnsV2Table?.row_count, 1);
    // V2 sidecar tables have typed columns, not payload_json. The inventory
    // surfaces has_payload_json=false for them.
    assert.equal(turnsV2Table?.has_payload_json, false);

    const contextsV2Table = inventory.tables.find((table) => table.name === "turn_context_refs_v2");
    assert.equal(contextsV2Table?.row_count, 1);
    assert.equal(contextsV2Table?.has_payload_json, false);

    const sourceRootInventory = inventory.source_roots.find((source) => source.base_dir === sourceRoot);
    assert.equal(sourceRootInventory?.status, "ok");
    assert.equal(sourceRootInventory?.file_count, 2);
    assert.ok((sourceRootInventory?.total_bytes ?? 0) > 0);
    assert.equal(inventory.totals.source_root_files, 2);
    assert.equal(inventory.totals.evidence_store_files, inventory.evidence_store.file_count);
    assert.equal(inventory.totals.evidence_store_bytes, inventory.evidence_store.total_bytes);
    assert.ok(inventory.totals.payload_json_bytes > 0);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
