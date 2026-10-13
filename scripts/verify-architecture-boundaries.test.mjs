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

async function createFixture(t, { includeRoot = "src", forbidden = "forbidden-package", match = "module-specifier", omitMatch = false } = {}) {
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
        ...(omitMatch ? {} : { match }),
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

test("module rules ignore comments and ordinary content mentioning a forbidden owner", async (t) => {
  const root = await createFixture(t);
  await writeFile(path.join(root, "src/index.ts"), `// import "forbidden-package";
/* export * from "forbidden-package"; */
const explanation = 'require("forbidden-package")';
export const value = "forbidden-package";
`);
  const result = await verifyArchitectureBoundaries({ root });
  assert.equal(result.ok, true, messages(result));
});

const forbiddenModuleForms = [
  ['static import', 'import { value } from "forbidden-package";'],
  ['re-export', 'export { value } from "forbidden-package/subpath";'],
  ['type import', 'import type { Value } from "forbidden-package";'],
  ['import type expression', 'type T = import("forbidden-package").Value;'],
  ['import equals', 'import value = require("forbidden-package");'],
  ['dynamic import', 'const value = import("forbidden-package");'],
  ['dynamic template literal', 'const value = import(`forbidden-package`);'],
  ['require', 'const value = require("forbidden-package");'],
  ['module.require', 'const value = module.require("forbidden-package");'],
  ['require.resolve', 'const value = require.resolve("forbidden-package");'],
  ['escaped literal', 'const value = require("forbidden-\\u0070ackage");'],
];
for (const [form, code] of forbiddenModuleForms) {
  test(`module rules reject ${form} with the decoded owner and line`, async (t) => {
    const root = await createFixture(t);
    await writeFile(path.join(root, "src/index.ts"), `// harmless first line\n${code}\n`);
    const result = await verifyArchitectureBoundaries({ root });
    assert.equal(result.ok, false);
    assert.match(messages(result), /line 2: rule fixture-boundary forbids "forbidden-package"/);
  });
}

for (const code of [
  'export * from "../packages/storage/src/index.js";',
  'type T = import("../apps/tui/src/index.js").Value;',
  'const value = import("../packages/other/../storage/src/index.js");',
]) {
  test(`module rules normalize an importer-relative forbidden owner: ${code}`, async (t) => {
    const forbidden = code.includes("apps/tui") ? "apps/tui" : "packages/storage";
    const root = await createFixture(t, { forbidden });
    await writeFile(path.join(root, "src/index.ts"), `${code}\n`);
    const result = await verifyArchitectureBoundaries({ root });
    assert.equal(result.ok, false);
    assert.match(messages(result), /rule fixture-boundary forbids/);
  });
}

test("module owner patterns respect package and path segment boundaries", async (t) => {
  const root = await createFixture(t, { forbidden: "packages/storage" });
  await writeFile(path.join(root, "src/index.ts"), 'import "../packages/storage-lite/index.js";\n');
  assert.equal((await verifyArchitectureBoundaries({ root })).ok, true);
  const packageRoot = await createFixture(t);
  await writeFile(path.join(packageRoot, "src/index.ts"), 'import "forbidden-package-compatible";\n');
  assert.equal((await verifyArchitectureBoundaries({ root: packageRoot })).ok, true);
});

for (const code of [
  'import(target);',
  'import(`allowed-${name}`);',
  'require("allowed-" + name);',
  'module.require(target);',
  'require.resolve(target);',
]) {
  test(`module rules reject an unsupported nonliteral loader: ${code}`, async (t) => {
    const root = await createFixture(t);
    await writeFile(path.join(root, "src/index.ts"), `${code}\n`);
    const result = await verifyArchitectureBoundaries({ root });
    assert.equal(result.ok, false);
    assert.match(messages(result), /nonliteral module reference/);
  });
}

test("module rules reject malformed syntax rather than claim understood dependencies", async (t) => {
  const root = await createFixture(t);
  await writeFile(path.join(root, "src/index.ts"), 'import { from "allowed-package";\n');
  const result = await verifyArchitectureBoundaries({ root });
  assert.equal(result.ok, false);
  assert.match(messages(result), /cannot parse module references/);
});

test("module rules reject a relative reference outside the repository", async (t) => {
  const root = await createFixture(t);
  await writeFile(path.join(root, "src/index.ts"), 'import "../../outside/index.js";\n');
  const result = await verifyArchitectureBoundaries({ root });
  assert.equal(result.ok, false);
  assert.match(messages(result), /module reference must stay inside repository/);
});

test("invalid matching modes cannot silently weaken a boundary", async (t) => {
  const root = await createFixture(t, { match: "ignore-imports" });
  const result = await verifyArchitectureBoundaries({ root });
  assert.equal(result.ok, false);
  assert.match(messages(result), /invalid match mode/);
});

test("legacy literal mode retains whole-text matching when explicit or omitted", async (t) => {
  for (const options of [{ match: "literal" }, { omitMatch: true }]) {
    const root = await createFixture(t, options);
    await writeFile(path.join(root, "src/index.ts"), '// forbidden-package\n');
    const result = await verifyArchitectureBoundaries({ root });
    assert.equal(result.ok, false);
    assert.match(messages(result), /rule fixture-boundary forbids/);
  }
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
