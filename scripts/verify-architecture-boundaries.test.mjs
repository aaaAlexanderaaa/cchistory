import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyArchitectureBoundaries } from "./verify-architecture-boundaries.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

function messages(result) {
  return result.errors.map((error) => `${error.path}: ${error.message}`).join("\n");
}

async function createFixture(t, { includeRoot = "src", forbidden = "forbidden-package" } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cchistory-architecture-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "index.ts"), "export const value = 1;\n", "utf8");
  await writeFile(
    path.join(root, "architecture-rules.json"),
    JSON.stringify({
      version: 1,
      complements: ["semantic-domain-check"],
      rules: [{
        id: "fixture-boundary",
        description: "Fixture production code must not import the forbidden package.",
        includeRoots: [includeRoot],
        extensions: [".ts"],
        excludeSuffixes: [".test.ts"],
        forbiddenPatterns: [forbidden],
      }],
    }, null, 2),
    "utf8",
  );
  return root;
}

test("repository architecture boundaries pass", async () => {
  const result = await verifyArchitectureBoundaries({ root: repositoryRoot });
  assert.equal(result.ok, true, messages(result));
});

test("declared architecture rules reject forbidden production references", async (t) => {
  const root = await createFixture(t);
  await writeFile(
    path.join(root, "src", "index.ts"),
    'import "forbidden-package";\n',
    "utf8",
  );
  const result = await verifyArchitectureBoundaries({ root });
  assert.equal(result.ok, false);
  assert.match(messages(result), /rule fixture-boundary forbids "forbidden-package"/);
});

test("declared architecture rules cannot pass vacuously", async (t) => {
  const root = await createFixture(t, { includeRoot: "missing-src" });
  const result = await verifyArchitectureBoundaries({ root });
  assert.equal(result.ok, false);
  assert.match(messages(result), /matches no production files \(vacuous rule\)/);
});

test("architecture include roots cannot escape the repository", async (t) => {
  const root = await createFixture(t, { includeRoot: "../outside" });
  const result = await verifyArchitectureBoundaries({ root });
  assert.equal(result.ok, false);
  assert.match(messages(result), /include root must stay inside repository/);
});

test("architecture include roots cannot escape through repository symlinks", async (t) => {
  const root = await createFixture(t, { includeRoot: "linked-src" });
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-architecture-outside-"));
  t.after(async () => rm(outsideRoot, { recursive: true, force: true }));
  await writeFile(path.join(outsideRoot, "index.ts"), "export const outside = true;\n", "utf8");
  await symlink(outsideRoot, path.join(root, "linked-src"));
  const result = await verifyArchitectureBoundaries({ root });
  assert.equal(result.ok, false);
  assert.match(messages(result), /include root must stay inside repository: linked-src/);
});

test("architecture include roots reject nested symbolic links", async (t) => {
  const root = await createFixture(t);
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-architecture-nested-outside-"));
  t.after(async () => rm(outsideRoot, { recursive: true, force: true }));
  await writeFile(path.join(outsideRoot, "escaped.ts"), 'import "forbidden-package";\n', "utf8");
  await symlink(path.join(outsideRoot, "escaped.ts"), path.join(root, "src", "escaped.ts"));
  const result = await verifyArchitectureBoundaries({ root });
  assert.equal(result.ok, false);
  assert.match(messages(result), /rule fixture-boundary cannot scan include root: symbolic link is not permitted: src\/escaped\.ts/);
});
