import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { resolveDefaultCchistoryDataDir } from "../store-layout.js";

test("default data dir is home-anchored even when an ancestor .cchistory exists", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-store-layout-"));

  try {
    const homeDir = path.join(tempRoot, "home");
    const projectRoot = path.join(tempRoot, "workspace");
    const nestedCwd = path.join(projectRoot, "apps", "cli");
    await mkdir(homeDir, { recursive: true });
    await mkdir(path.join(projectRoot, ".cchistory"), { recursive: true });
    await mkdir(nestedCwd, { recursive: true });

    assert.equal(
      resolveDefaultCchistoryDataDir({ cwd: nestedCwd, homeDir }),
      path.join(homeDir, ".cchistory"),
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
