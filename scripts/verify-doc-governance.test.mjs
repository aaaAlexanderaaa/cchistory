import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyDocGovernance } from "./verify-doc-governance.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const fixedToday = new Date("2026-07-26T00:00:00.000Z");

async function copyEntry(source, target) {
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, force: true });
}

async function createFixture(t) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-doc-governance-"));
  t.after(async () => rm(temporaryRoot, { recursive: true, force: true }));
  const policy = JSON.parse(await readFile(path.join(repositoryRoot, "docs-policy.json"), "utf8"));
  await copyEntry(path.join(repositoryRoot, "docs-policy.json"), path.join(temporaryRoot, "docs-policy.json"));
  for (const entry of policy.governedFiles) {
    await copyEntry(path.join(repositoryRoot, entry.path), path.join(temporaryRoot, entry.path));
  }
  for (const entry of policy.governedRoots) {
    await copyEntry(path.join(repositoryRoot, entry), path.join(temporaryRoot, entry));
  }
  await copyEntry(path.join(repositoryRoot, policy.templates.root), path.join(temporaryRoot, policy.templates.root));
  return temporaryRoot;
}

async function replace(root, relativePath, before, after) {
  const target = path.join(root, relativePath);
  const text = await readFile(target, "utf8");
  assert.ok(text.includes(before), `fixture precondition missing in ${relativePath}`);
  await writeFile(target, text.replace(before, after), "utf8");
}

function messages(result) {
  return result.errors.map((error) => `${error.path}: ${error.message}`).join("\n");
}

test("repository document governance passes", async () => {
  const result = await verifyDocGovernance({ root: repositoryRoot, today: fixedToday });
  assert.equal(result.ok, true, messages(result));
});

test("governed entrypoints require lifecycle metadata", async (t) => {
  const root = await createFixture(t);
  await replace(root, "ARCHITECTURE.md", "authority: normative\n", "");
  const result = await verifyDocGovernance({ root, today: fixedToday });
  assert.equal(result.ok, false);
  assert.match(messages(result), /ARCHITECTURE\.md: missing required metadata: authority/);
});

test("governed frontmatter accepts CRLF checkouts", async (t) => {
  const root = await createFixture(t);
  const target = path.join(root, "ARCHITECTURE.md");
  const text = await readFile(target, "utf8");
  await writeFile(target, text.replace(/\n/g, "\r\n"), "utf8");
  const result = await verifyDocGovernance({ root, today: fixedToday });
  assert.equal(result.ok, true, messages(result));
});

test("relationship paths cannot escape the repository", async (t) => {
  const root = await createFixture(t);
  await replace(
    root,
    "docs/plans/2026-07-26-repository-governance-migration.md",
    "implements: docs/contracts/repository-governance.md",
    "implements: ../outside.md",
  );
  const result = await verifyDocGovernance({ root, today: fixedToday });
  assert.equal(result.ok, false);
  assert.match(messages(result), /implements path must stay inside repository/);
});

test("relationship paths cannot escape through repository symlinks", async (t) => {
  const root = await createFixture(t);
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-doc-governance-outside-"));
  t.after(async () => rm(outsideRoot, { recursive: true, force: true }));
  await writeFile(path.join(outsideRoot, "contract.md"), "outside\n", "utf8");
  await symlink(path.join(outsideRoot, "contract.md"), path.join(root, "docs", "outside-contract.md"));
  await replace(
    root,
    "docs/plans/2026-07-26-repository-governance-migration.md",
    "implements: docs/contracts/repository-governance.md",
    "implements: docs/outside-contract.md",
  );
  const result = await verifyDocGovernance({ root, today: fixedToday });
  assert.equal(result.ok, false);
  assert.match(messages(result), /implements path must stay inside repository: docs\/outside-contract\.md/);
});

test("governed roots reject nested symbolic links", async (t) => {
  const root = await createFixture(t);
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-doc-governance-nested-outside-"));
  t.after(async () => rm(outsideRoot, { recursive: true, force: true }));
  await writeFile(path.join(outsideRoot, "contract.md"), "outside\n", "utf8");
  await symlink(path.join(outsideRoot, "contract.md"), path.join(root, "docs", "contracts", "external-contract.md"));
  const result = await verifyDocGovernance({ root, today: fixedToday });
  assert.equal(result.ok, false);
  assert.match(messages(result), /docs\/contracts: cannot scan governed root: symbolic link is not permitted: docs\/contracts\/external-contract\.md/);
});

test("document roles constrain authority", async (t) => {
  const root = await createFixture(t);
  await replace(
    root,
    "docs/evidence/2026-07-26-repository-governance-technical-verification.md",
    "authority: evidence",
    "authority: normative",
  );
  const result = await verifyDocGovernance({ root, today: fixedToday });
  assert.equal(result.ok, false);
  assert.match(messages(result), /evidence does not permit authority: normative/);
});

test("document roles constrain lifecycle status", async (t) => {
  const root = await createFixture(t);
  await replace(
    root,
    "docs/evidence/2026-07-26-repository-governance-technical-verification.md",
    "status: historical",
    "status: current",
  );
  const result = await verifyDocGovernance({ root, today: fixedToday });
  assert.equal(result.ok, false);
  assert.match(messages(result), /evidence does not permit status: current/);
});

test("every allowed document type requires a role policy", async (t) => {
  const root = await createFixture(t);
  const target = path.join(root, "docs-policy.json");
  const policy = JSON.parse(await readFile(target, "utf8"));
  delete policy.allowed.roles.evidence;
  await writeFile(target, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
  const result = await verifyDocGovernance({ root, today: fixedToday });
  assert.equal(result.ok, false);
  assert.match(messages(result), /docs-policy\.json: missing role policy for doc_type: evidence/);
});

test("overdue target contracts fail", async (t) => {
  const root = await createFixture(t);
  await replace(
    root,
    "docs/contracts/repository-governance.md",
    "review_due: 2026-10-24",
    "review_due: 2026-07-25",
  );
  const result = await verifyDocGovernance({ root, today: fixedToday });
  assert.equal(result.ok, false);
  assert.match(messages(result), /target document review overdue since 2026-07-25/);
});

test("explicit target review dates cannot exceed the maximum age", async (t) => {
  const root = await createFixture(t);
  await replace(
    root,
    "docs/contracts/repository-governance.md",
    "review_due: 2026-10-24",
    "review_due: 2099-10-24",
  );
  const result = await verifyDocGovernance({ root, today: fixedToday });
  assert.equal(result.ok, false);
  assert.match(messages(result), /review_due exceeds target maximum age deadline 2026-10-24: 2099-10-24/);
});

test("structured promises require an owner", async (t) => {
  const root = await createFixture(t);
  await replace(
    root,
    "docs/contracts/repository-governance.md",
    "status=open; owner=repository-maintainer; description=",
    "status=open; description=",
  );
  const result = await verifyDocGovernance({ root, today: fixedToday });
  assert.equal(result.ok, false);
  assert.match(messages(result), /promise\[independent-governance-review\] missing owner/);
});

test("required governance templates cannot disappear", async (t) => {
  const root = await createFixture(t);
  await unlink(path.join(root, "docs/templates/independent-review.md"));
  const result = await verifyDocGovernance({ root, today: fixedToday });
  assert.equal(result.ok, false);
  assert.match(messages(result), /independent-review\.md: required template is missing/);
});

test("required governance template sections cannot drift", async (t) => {
  const root = await createFixture(t);
  await replace(
    root,
    "docs/templates/implementation-plan.md",
    "## Review topology",
    "## Review arrangement",
  );
  const result = await verifyDocGovernance({ root, today: fixedToday });
  assert.equal(result.ok, false);
  assert.match(messages(result), /template missing required section: Review topology/);
});

test("contract templates require contract-specific lifecycle metadata", async (t) => {
  const root = await createFixture(t);
  await replace(root, "docs/templates/contract.md", "implementation: not_started\n", "");
  const result = await verifyDocGovernance({ root, today: fixedToday });
  assert.equal(result.ok, false);
  assert.match(messages(result), /docs\/templates\/contract\.md: contract missing implementation status/);
});

test("plan templates require an implements relationship", async (t) => {
  const root = await createFixture(t);
  await replace(
    root,
    "docs/templates/implementation-plan.md",
    "implements: docs/contracts/{{contract}}.md\n",
    "",
  );
  const result = await verifyDocGovernance({ root, today: fixedToday });
  assert.equal(result.ok, false);
  assert.match(messages(result), /docs\/templates\/implementation-plan\.md: plans require an implements relationship/);
});
