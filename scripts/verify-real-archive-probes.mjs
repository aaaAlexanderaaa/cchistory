import assert from "node:assert/strict";
import path from "node:path";
import { existsSync, globSync, statSync } from "node:fs";

const DEFAULT_ARCHIVE_ROOT = ".realdata/config_dots_20260331_212353";

function main() {
  const args = parseArgs(process.argv.slice(2));
  const archiveRoot = path.resolve(args.archiveRoot ?? DEFAULT_ARCHIVE_ROOT);

  assert.ok(existsSync(archiveRoot), `Real archive root does not exist: ${archiveRoot}`);

  const checks = [
    {
      label: "Gemini chat JSON",
      pattern: "**/.gemini/tmp/*/chats/*.json",
      expectedKind: "minimum",
      expectedCount: 1,
    },
    {
      label: "Gemini logs.json",
      pattern: "**/.gemini/tmp/*/logs.json",
      expectedKind: "minimum",
      expectedCount: 1,
    },
    {
      label: "Gemini .project_root absence",
      pattern: "**/.gemini/**/.project_root",
      expectedKind: "exact",
      expectedCount: 0,
    },
    {
      label: "Gemini projects.json absence",
      pattern: "**/.gemini/**/projects.json",
      expectedKind: "exact",
      expectedCount: 0,
    },
    {
      label: "Cursor chat-store databases",
      pattern: "**/.cursor/chats/*/*/store.db",
      expectedKind: "minimum",
      expectedCount: 1,
    },
    {
      label: "CodeBuddy transcript JSONL",
      pattern: "**/.codebuddy/projects/**/*.jsonl",
      expectedKind: "minimum",
      expectedCount: 1,
    },
    {
      label: "OpenCode global sessions",
      pattern: "**/.local/share/opencode/storage/session/global/*.json",
      expectedKind: "minimum",
      expectedCount: 1,
    },
    {
      label: "OpenCode messages",
      pattern: "**/.local/share/opencode/storage/message/**/*.json",
      expectedKind: "minimum",
      expectedCount: 1,
    },
    {
      label: "OpenCode parts",
      pattern: "**/.local/share/opencode/storage/part/**/*.json",
      expectedKind: "minimum",
      expectedCount: 1,
    },
  ];

  const results = checks.map((check) => evaluateCheck(archiveRoot, check));
  const codeBuddyFiles = globMatches(archiveRoot, "**/.codebuddy/projects/**/*.jsonl");
  const nonEmptyCodeBuddyCount = codeBuddyFiles.filter((filePath) => statSync(filePath).size > 0).length;

  assert.ok(nonEmptyCodeBuddyCount >= 1, `CodeBuddy non-empty JSONL drifted: expected at least 1 non-empty file under ${archiveRoot}, found ${nonEmptyCodeBuddyCount}.`);

  console.log(`Real-archive probe root: ${archiveRoot}`);
  for (const result of results) {
    const expectation = result.expectedKind === "exact" ? `exactly ${result.expectedCount}` : `>= ${result.expectedCount}`;
    console.log(`- ${result.label}: ${result.actualCount} matches (expected ${expectation})`);
  }
  console.log(`- CodeBuddy non-empty JSONL: ${nonEmptyCodeBuddyCount} files (expected >= 1)`);
  console.log("Real-archive probe verification passed.");
}

function parseArgs(argv) {
  let archiveRoot;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--") {
      continue;
    }
    if (value === "--archive-root") {
      const nextValue = argv[index + 1];
      if (!nextValue) {
        throw new Error("`--archive-root` requires a directory path.");
      }
      archiveRoot = nextValue;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${value}`);
  }

  return { archiveRoot };
}

function evaluateCheck(archiveRoot, check) {
  const actualCount = globMatches(archiveRoot, check.pattern).length;

  if (check.expectedKind === "exact") {
    assert.equal(
      actualCount,
      check.expectedCount,
      `${check.label} drifted: expected exactly ${check.expectedCount} matches for ${check.pattern} under ${archiveRoot}, found ${actualCount}.`,
    );
  } else {
    assert.ok(
      actualCount >= check.expectedCount,
      `${check.label} drifted: expected at least ${check.expectedCount} matches for ${check.pattern} under ${archiveRoot}, found ${actualCount}.`,
    );
  }

  return {
    label: check.label,
    expectedKind: check.expectedKind,
    expectedCount: check.expectedCount,
    actualCount,
  };
}

function globMatches(cwd, pattern) {
  return globSync(pattern, {
    cwd,
    dot: true,
    exclude: ["**/node_modules/**"],
  }).map((match) => path.join(cwd, match));
}

main();
