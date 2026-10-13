#!/usr/bin/env node

import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

function outsideRepository(relative) {
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function moduleReferences(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const references = [];
  const problems = [];
  const lineAt = (position) => source.getLineAndCharacterOfPosition(position).line + 1;
  for (const diagnostic of source.parseDiagnostics) {
    problems.push(`line ${lineAt(diagnostic.start ?? 0)}: cannot parse module references: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
  }
  const unwrap = (node) => {
    while (node && ts.isParenthesizedExpression(node)) node = node.expression;
    return node;
  };
  const addReference = (argument, owner) => {
    argument = unwrap(argument);
    const line = lineAt(owner.getStart(source));
    if (argument && ts.isStringLiteralLike(argument)) references.push({ specifier: argument.text, line });
    else problems.push(`line ${line}: nonliteral module reference cannot be checked`);
  };
  const isLoader = (expression) => {
    expression = unwrap(expression);
    if (expression.kind === ts.SyntaxKind.ImportKeyword) return true;
    if (ts.isIdentifier(expression)) return expression.text === "require";
    return ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)
      && ((expression.expression.text === "require" && expression.name.text === "resolve")
        || (expression.expression.text === "module" && expression.name.text === "require"));
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) addReference(node.moduleSpecifier, node);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      addReference(node.moduleReference.expression, node);
    } else if (ts.isImportTypeNode(node)) {
      addReference(ts.isLiteralTypeNode(node.argument) ? node.argument.literal : node.argument, node);
    } else if (ts.isCallExpression(node) && isLoader(node.expression)) {
      addReference(node.arguments[0], node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { references, problems };
}

function ownerMatches(reference, forbidden) {
  return reference === forbidden || reference.startsWith(`${forbidden}/`);
}

async function repositoryPath(root, relativePath) {
  if (typeof relativePath !== "string" || !relativePath || path.isAbsolute(relativePath)) return null;
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (outsideRepository(relative)) return null;
  try {
    const canonical = await realpath(resolved);
    const canonicalRelative = path.relative(root, canonical);
    if (outsideRepository(canonicalRelative)) return null;
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
  const sources = new Map();
  let fileCount = 0;
  for (const [index, rule] of (Array.isArray(manifest.rules) ? manifest.rules : []).entries()) {
    if (!rule || typeof rule !== "object") {
      add("architecture-rules.json", `rule ${index + 1} must be an object`);
      continue;
    }
    const label = rule.id || `rule-${index + 1}`;
    if (!rule.id || !/^[a-z0-9][a-z0-9-]*$/.test(rule.id)) add("architecture-rules.json", `rule ${index + 1} has invalid id`);
    else if (seen.has(rule.id)) add("architecture-rules.json", `duplicate rule id: ${rule.id}`);
    seen.add(rule.id);
    if (!rule.description) add("architecture-rules.json", `rule ${label} requires a description`);
    if (!Array.isArray(rule.includeRoots) || rule.includeRoots.length === 0) add("architecture-rules.json", `rule ${label} requires includeRoots`);
    if (!Array.isArray(rule.forbiddenPatterns) || rule.forbiddenPatterns.length === 0) add("architecture-rules.json", `rule ${label} requires forbiddenPatterns`);
    const mode = rule.match === undefined ? "literal" : rule.match;
    if (mode !== "literal" && mode !== "module-specifier") {
      add("architecture-rules.json", `rule ${label} has invalid match mode: ${JSON.stringify(mode)}`);
      continue;
    }
    const matched = new Set();
    for (const relativeRoot of Array.isArray(rule.includeRoots) ? rule.includeRoots : []) {
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
    const patterns = [];
    for (const forbidden of Array.isArray(rule.forbiddenPatterns) ? rule.forbiddenPatterns : []) {
      if (typeof forbidden !== "string" || forbidden.length === 0) {
        add("architecture-rules.json", `rule ${label} has an invalid forbidden pattern`);
        continue;
      }
      patterns.push(forbidden);
    }
    for (const file of matched) {
      const relativeFile = path.relative(root, file);
      try {
        if (!sources.has(file)) sources.set(file, { text: await readFile(file, "utf8") });
        const source = sources.get(file);
        if (mode === "literal") {
          for (const forbidden of patterns) {
            const lineIndex = source.text.split("\n").findIndex((line) => line.includes(forbidden));
            if (lineIndex >= 0) add(relativeFile, `line ${lineIndex + 1}: rule ${label} forbids ${JSON.stringify(forbidden)}`);
          }
          continue;
        }
        source.modules ??= moduleReferences(file, source.text);
        for (const problem of source.modules.problems) add(relativeFile, `rule ${label}: ${problem}`);
        for (const { specifier, line } of source.modules.references) {
          let reference = specifier;
          if (specifier.startsWith(".") || path.isAbsolute(specifier)) {
            const relative = path.relative(root, path.resolve(path.dirname(file), specifier));
            if (outsideRepository(relative)) {
              add(relativeFile, `line ${line}: rule ${label}: module reference must stay inside repository: ${JSON.stringify(specifier)}`);
              continue;
            }
            reference = relative.split(path.sep).join("/");
          }
          for (const forbidden of patterns) {
            if (ownerMatches(reference, forbidden)) add(relativeFile, `line ${line}: rule ${label} forbids ${JSON.stringify(forbidden)} (module ${JSON.stringify(specifier)})`);
          }
        }
      } catch (error) {
        add(relativeFile, `rule ${label} cannot inspect source: ${error.message}`);
      }
    }
  }
  errors.sort((a, b) => a.path.localeCompare(b.path) || a.message.localeCompare(b.message));
  return { ok: errors.length === 0, errors, ruleCount: Array.isArray(manifest.rules) ? manifest.rules.length : 0, fileCount };
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
