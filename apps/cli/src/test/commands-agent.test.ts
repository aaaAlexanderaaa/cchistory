import { test } from "node:test";

// Agent pair/pull tests require a live remote API server.
// Skip until a mock server or test harness is available.

test("agent pair initializes remote agent link and pulls initial bundle", { skip: "requires live remote API server" }, async () => {
  // placeholder — needs mock server for pairRemoteAgent()
});

test("agent pull retrieves latest sessions from paired remote agent", { skip: "requires live remote API server" }, async () => {
  // placeholder — needs mock server for agent pull
});
