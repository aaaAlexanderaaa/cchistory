import { test } from "node:test";
import assert from "node:assert/strict";
import { rebuildTuiArgs } from "../main.js";

test("rebuildTuiArgs forwards --project / --session / --turn entry flags", () => {
  const context = {
    commandPath: ["tui"],
    positionals: [],
    options: {
      source: [],
      project: "my-app",
      session: undefined,
      turn: "01H...",
      search: undefined,
      sourceHealth: false,
    },
    globals: {},
    io: { cwd: process.cwd(), stdout: () => {}, stderr: () => {} },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const args = rebuildTuiArgs(context as any);
  assert.ok(args.includes("--project"), `expected --project in ${JSON.stringify(args)}`);
  assert.equal(args[args.indexOf("--project") + 1], "my-app");
  assert.ok(args.includes("--turn"), `expected --turn in ${JSON.stringify(args)}`);
  assert.equal(args[args.indexOf("--turn") + 1], "01H...");
  assert.ok(!args.includes("--session"), "session should be omitted when unset");
});

test("rebuildTuiArgs omits entry flags entirely when none are set", () => {
  const context = {
    commandPath: ["tui"],
    positionals: [],
    options: { source: [] },
    globals: {},
    io: { cwd: process.cwd(), stdout: () => {}, stderr: () => {} },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const args = rebuildTuiArgs(context as any);
  for (const flag of ["--project", "--session", "--turn"]) {
    assert.ok(!args.includes(flag), `unexpected ${flag} in ${JSON.stringify(args)}`);
  }
});
