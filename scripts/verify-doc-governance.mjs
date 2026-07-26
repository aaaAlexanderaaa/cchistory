#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_METADATA = ["doc_type", "status", "authority", "last_reconciled"];
const PROMISE_RE = /^\s*-\s*promise\[([a-z0-9][a-z0-9-]*)\]:\s*(.+?)\s*$/;

function parseFrontmatter(text) {
  if (!text.startsWith("---\n")) {
    return { metadata: {}, error: "missing frontmatter" };
  }
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) {
    return { metadata: {}, error: "unterminated frontmatter" };
  }
  const metadata = {};
  for (const rawLine of text.slice(4, end).split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator < 1) {
      return { metadata, error: `invalid frontmatter line: ${line}` };
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (Object.hasOwn(metadata, key)) {
      return { metadata, error: `duplicate frontmatter key: ${key}` };
    }
    metadata[key] = value;
  }
  return { metadata, error: null };
}

function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return null;
  const result = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(result.valueOf())) return null;
  return result.toISOString().slice(0, 10) === value ? result : null;
}

function addDays(value, days) {
  return new Date(value.valueOf() + days * 24 * 60 * 60 * 1000);
}

function normalizeHeading(value) {
  return value.trim().replace(/[`*_~]/g, "").replace(/\s+/g, " ").toLowerCase();
}

function headings(text) {
  const result = new Set();
  for (const line of text.split("\n")) {
    const match = /^#{2,6}\s+(.+?)\s*$/.exec(line);
    if (match) result.add(normalizeHeading(match[1]));
  }
  return result;
}

function relationValues(rawValue) {
  const value = (rawValue ?? "").trim();
  if (!value || value === "[]") return [];
  const payload = value.startsWith("[") && value.endsWith("]")
    ? value.slice(1, -1)
    : value;
  return payload.split(",").map((item) => item.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

function recordFields(payload) {
  const fields = {};
  const errors = [];
  for (const rawItem of payload.split(";")) {
    const item = rawItem.trim();
    if (!item) continue;
    const separator = item.indexOf("=");
    if (separator < 1 || separator === item.length - 1) {
      errors.push(`invalid record item: ${item}`);
      continue;
    }
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (Object.hasOwn(fields, key)) errors.push(`duplicate record field: ${key}`);
    fields[key] = value;
  }
  return { fields, errors };
}

function repositoryPath(root, relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) return null;
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return null;
  }
  return resolved;
}

async function markdownFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await markdownFiles(candidate));
    else if (entry.isFile() && entry.name.endsWith(".md")) result.push(candidate);
  }
  return result;
}

export async function verifyDocGovernance({ root = process.cwd(), today = new Date() } = {}) {
  root = path.resolve(root);
  today = parseDate(new Date(today).toISOString().slice(0, 10));
  const errors = [];
  const add = (relativePath, message) => errors.push({ path: relativePath, message });
  const policyPath = path.join(root, "docs-policy.json");
  let policy;
  try {
    policy = JSON.parse(await readFile(policyPath, "utf8"));
  } catch (error) {
    add("docs-policy.json", `cannot load policy: ${error.message}`);
    return { ok: false, errors, governedCount: 0, templateCount: 0 };
  }
  if (policy.version !== 1) add("docs-policy.json", "policy requires version 1");

  const governed = new Map();
  for (const expected of policy.governedFiles ?? []) {
    const resolved = repositoryPath(root, expected.path);
    if (!resolved) {
      add("docs-policy.json", `governed path must stay inside repository: ${expected.path}`);
      continue;
    }
    governed.set(resolved, expected);
  }
  for (const relativeRoot of policy.governedRoots ?? []) {
    const resolvedRoot = repositoryPath(root, relativeRoot);
    if (!resolvedRoot) {
      add("docs-policy.json", `governed root must stay inside repository: ${relativeRoot}`);
      continue;
    }
    try {
      for (const file of await markdownFiles(resolvedRoot)) {
        if (!governed.has(file)) governed.set(file, { path: path.relative(root, file) });
      }
    } catch (error) {
      add(relativeRoot, `cannot scan governed root: ${error.message}`);
    }
  }

  const allowed = policy.allowed ?? {};
  const records = new Map();
  for (const [absolutePath, expected] of [...governed.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const relativePath = path.relative(root, absolutePath);
    let text;
    try {
      text = await readFile(absolutePath, "utf8");
    } catch (error) {
      add(relativePath, `cannot read governed document: ${error.message}`);
      continue;
    }
    const { metadata, error } = parseFrontmatter(text);
    if (error) add(relativePath, error);
    records.set(absolutePath, metadata);
    for (const field of REQUIRED_METADATA) {
      if (!metadata[field]) add(relativePath, `missing required metadata: ${field}`);
    }
    for (const [field, values] of [
      ["doc_type", allowed.docTypes],
      ["status", allowed.statuses],
      ["authority", allowed.authorities],
    ]) {
      if (metadata[field] && !values?.includes(metadata[field])) {
        add(relativePath, `invalid ${field}: ${metadata[field]}`);
      }
    }
    for (const [field, expectedValue] of [
      ["doc_type", expected.docType],
      ["status", expected.status],
      ["authority", expected.authority],
    ]) {
      if (expectedValue && metadata[field] !== expectedValue) {
        add(relativePath, `${field} must be ${expectedValue}: ${metadata[field] ?? "missing"}`);
      }
    }
    const reconciled = parseDate(metadata.last_reconciled);
    if (metadata.last_reconciled && !reconciled) {
      add(relativePath, `last_reconciled must be YYYY-MM-DD: ${metadata.last_reconciled}`);
    } else if (reconciled && reconciled > addDays(today, policy.futureDateToleranceDays ?? 0)) {
      add(relativePath, `last_reconciled is in the future: ${metadata.last_reconciled}`);
    }
    if (["contract", "surface-contract"].includes(metadata.doc_type)) {
      if (metadata.authority !== "normative") add(relativePath, "contracts require authority: normative");
      if (!metadata.implementation) add(relativePath, "contract missing implementation status");
      else if (!allowed.implementations?.includes(metadata.implementation)) add(relativePath, `invalid implementation: ${metadata.implementation}`);
      if (!metadata.verification_status) add(relativePath, "contract missing verification_status");
      else if (!allowed.verificationStatuses?.includes(metadata.verification_status)) add(relativePath, `invalid verification_status: ${metadata.verification_status}`);
      if (metadata.status === "current" && metadata.implementation === "not_started") add(relativePath, "current contract cannot be implementation: not_started");
      if (metadata.status === "target" && metadata.implementation === "implemented") add(relativePath, "target contract cannot claim implementation: implemented");
      if (metadata.status === "target") {
        const due = metadata.review_due ? parseDate(metadata.review_due) : reconciled && addDays(reconciled, policy.targetMaxAgeDays ?? 90);
        if (metadata.review_due && !due) add(relativePath, `review_due must be YYYY-MM-DD: ${metadata.review_due}`);
        else if (due && today > due) add(relativePath, `target document review overdue since ${due.toISOString().slice(0, 10)}`);
      }
    }
    if (metadata.doc_type === "plan") {
      if (metadata.authority !== "planning") add(relativePath, "plans require authority: planning");
      if (!metadata.implements) add(relativePath, "plans require an implements relationship");
      if (metadata.status === "current") add(relativePath, "plans cannot use status: current");
    }
    if (metadata.status === "superseded" && !metadata.superseded_by) {
      add(relativePath, "status superseded requires superseded_by");
    }
    if (/\{\{[^}]+\}\}/.test(text)) add(relativePath, "unresolved placeholder in governed document");

    for (const field of policy.relationshipFields ?? []) {
      for (const value of relationValues(metadata[field])) {
        const withoutFragment = value.split("#", 1)[0];
        const target = repositoryPath(root, withoutFragment);
        if (!target) add(relativePath, `${field} path must stay inside repository: ${value}`);
        else {
          try { await readFile(target); }
          catch { add(relativePath, `${field} points to missing path: ${value}`); }
        }
      }
    }

    const seenPromises = new Set();
    for (const [index, line] of text.split("\n").entries()) {
      const match = PROMISE_RE.exec(line);
      if (!match) continue;
      const [, id, payload] = match;
      if (seenPromises.has(id)) add(relativePath, `line ${index + 1}: duplicate promise[${id}]`);
      seenPromises.add(id);
      const { fields, errors: fieldErrors } = recordFields(payload);
      for (const fieldError of fieldErrors) add(relativePath, `line ${index + 1}: promise[${id}] ${fieldError}`);
      for (const required of ["due", "status", "owner", "description"]) {
        if (!fields[required]) add(relativePath, `line ${index + 1}: promise[${id}] missing ${required}`);
      }
      const due = parseDate(fields.due);
      if (fields.due && !due) add(relativePath, `line ${index + 1}: promise[${id}] due must be YYYY-MM-DD`);
      if (fields.status && !allowed.promiseStatuses?.includes(fields.status)) add(relativePath, `line ${index + 1}: promise[${id}] invalid status: ${fields.status}`);
      if (due && fields.status === "open" && today > due) add(relativePath, `line ${index + 1}: open promise[${id}] overdue since ${fields.due}`);
    }
  }

  const templateRoot = repositoryPath(root, policy.templates?.root);
  const requiredTemplates = policy.templates?.required ?? {};
  if (!templateRoot) add("docs-policy.json", "template root must stay inside repository");
  else {
    for (const [filename, requirement] of Object.entries(requiredTemplates)) {
      const absolutePath = path.join(templateRoot, filename);
      const relativePath = path.relative(root, absolutePath);
      let text;
      try { text = await readFile(absolutePath, "utf8"); }
      catch (error) { add(relativePath, `required template is missing: ${error.message}`); continue; }
      const { metadata, error } = parseFrontmatter(text);
      if (error) add(relativePath, error);
      for (const field of REQUIRED_METADATA) if (!metadata[field]) add(relativePath, `template missing metadata: ${field}`);
      if (metadata.doc_type !== requirement.docType) add(relativePath, `template doc_type must be ${requirement.docType}: ${metadata.doc_type ?? "missing"}`);
      if (!/\{\{[^}]+\}\}/.test(text)) add(relativePath, "template contains no placeholders");
      const inventory = headings(text);
      for (const section of requirement.sections ?? []) {
        if (!inventory.has(normalizeHeading(section))) add(relativePath, `template missing required section: ${section}`);
      }
    }
  }

  errors.sort((a, b) => a.path.localeCompare(b.path) || a.message.localeCompare(b.message));
  return { ok: errors.length === 0, errors, governedCount: records.size, templateCount: Object.keys(requiredTemplates).length };
}

function parseArgs(argv) {
  const result = { root: process.cwd(), today: new Date() };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") result.root = argv[++index];
    else if (arg === "--today") {
      const parsed = parseDate(argv[++index]);
      if (!parsed) throw new Error("--today requires YYYY-MM-DD");
      result.today = parsed;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return result;
}

async function runCli() {
  try {
    const result = await verifyDocGovernance(parseArgs(process.argv.slice(2)));
    if (result.ok) {
      console.log(`verify-doc-governance: OK — ${result.governedCount} governed documents and ${result.templateCount} templates`);
      return 0;
    }
    console.error(`verify-doc-governance: ${result.errors.length} problem(s)`);
    for (const error of result.errors) console.error(`${error.path}: ${error.message}`);
    return 1;
  } catch (error) {
    console.error(`verify-doc-governance: ${error.message}`);
    return 2;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) process.exitCode = await runCli();
