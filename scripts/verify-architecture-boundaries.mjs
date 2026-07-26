#!/usr/bin/env node

import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function repositoryPath(root, relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) return null;
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  try {
    const canonical = await realpath(resolved);
    const canonicalRelative = path.relative(root, canonical);
    if (canonicalRelative === ".." || canonicalRelative.startsWith(`..${path.sep}`) || path.isAbsolute(canonicalRelative)) return null;
    return canonical;
  } catch {
    // Let the caller report a more specific missing/unreadable-path error.
    return resolved;
  }
}

async function filesBelow(directory, repositoryRoot) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`symbolic link is not permitted: ${path.relative(repositoryRoot, candidate)}`);
    }
    if (entry.isDirectory()) result.push(...await filesBelow(candidate, repositoryRoot));
    else if (entry.isFile()) result.push(candidate);
  }
  return result;
}

export async function verifyArchitectureBoundaries({ root = process.cwd() } = {}) {
  root = await realpath(path.resolve(root));
  const errors = [];
  const add = (relativePath, message) => errors.push({ path: relativePath, message });
  let manifest;
  try { manifest = JSON.parse(await readFile(path.join(root, "architecture-rules.json"), "utf8")); }
  catch (error) {
    add("architecture-rules.json", `cannot load manifest: ${error.message}`);
    return { ok: false, errors, ruleCount: 0, fileCount: 0 };
  }
  if (manifest.version !== 1) add("architecture-rules.json", "manifest requires version 1");
  if (!Array.isArray(manifest.complements) || manifest.complements.length === 0) {
    add("architecture-rules.json", "manifest must name the domain-specific checks it complements");
  }
  if (!Array.isArray(manifest.rules) || manifest.rules.length === 0) {
    add("architecture-rules.json", "manifest requires at least one rule");
  }
  const seen = new Set();
  let fileCount = 0;
  for (const [index, rule] of (manifest.rules ?? []).entries()) {
    const label = rule.id || `rule-${index + 1}`;
    if (!rule.id || !/^[a-z0-9][a-z0-9-]*$/.test(rule.id)) add("architecture-rules.json", `rule ${index + 1} has invalid id`);
    else if (seen.has(rule.id)) add("architecture-rules.json", `duplicate rule id: ${rule.id}`);
    seen.add(rule.id);
    if (!rule.description) add("architecture-rules.json", `rule ${label} requires a description`);
    if (!Array.isArray(rule.includeRoots) || rule.includeRoots.length === 0) add("architecture-rules.json", `rule ${label} requires includeRoots`);
    if (!Array.isArray(rule.forbiddenPatterns) || rule.forbiddenPatterns.length === 0) add("architecture-rules.json", `rule ${label} requires forbiddenPatterns`);
    const matched = new Set();
    for (const relativeRoot of rule.includeRoots ?? []) {
      const includeRoot = await repositoryPath(root, relativeRoot);
      if (!includeRoot) {
        add("architecture-rules.json", `rule ${label} include root must stay inside repository: ${relativeRoot}`);
        continue;
      }
      try {
        for (const file of await filesBelow(includeRoot, root)) {
          if (rule.extensions?.length && !rule.extensions.includes(path.extname(file))) continue;
          if (rule.excludeSuffixes?.some((suffix) => file.endsWith(suffix))) continue;
          matched.add(file);
        }
      } catch (error) {
        add(relativeRoot, `rule ${label} cannot scan include root: ${error.message}`);
      }
    }
    if (matched.size === 0) add("architecture-rules.json", `rule ${label} matches no production files (vacuous rule)`);
    fileCount += matched.size;
    for (const forbidden of rule.forbiddenPatterns ?? []) {
      if (typeof forbidden !== "string" || forbidden.length === 0) {
        add("architecture-rules.json", `rule ${label} has an invalid forbidden pattern`);
        continue;
      }
      for (const file of matched) {
        const text = await readFile(file, "utf8");
        const lineIndex = text.split("\n").findIndex((line) => line.includes(forbidden));
        if (lineIndex >= 0) add(path.relative(root, file), `line ${lineIndex + 1}: rule ${label} forbids ${JSON.stringify(forbidden)}`);
      }
    }
  }
  errors.sort((a, b) => a.path.localeCompare(b.path) || a.message.localeCompare(b.message));
  return { ok: errors.length === 0, errors, ruleCount: manifest.rules?.length ?? 0, fileCount };
}

async function runCli() {
  const rootIndex = process.argv.indexOf("--root");
  if (process.argv.length > 2 && rootIndex < 0) {
    console.error(`verify-architecture-boundaries: unknown arguments: ${process.argv.slice(2).join(" ")}`);
    return 2;
  }
  const root = rootIndex >= 0 ? process.argv[rootIndex + 1] : process.cwd();
  const result = await verifyArchitectureBoundaries({ root });
  if (result.ok) {
    console.log(`verify-architecture-boundaries: OK — ${result.ruleCount} rules across ${result.fileCount} rule-file matches`);
    return 0;
  }
  console.error(`verify-architecture-boundaries: ${result.errors.length} problem(s)`);
  for (const error of result.errors) console.error(`${error.path}: ${error.message}`);
  return 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) process.exitCode = await runCli();
