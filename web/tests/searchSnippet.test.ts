import test from "node:test";
import assert from "node:assert/strict";

import { splitHighlightedSnippet } from "../src/searchSnippet.ts";

test("splits highlight markers into safe text segments", () => {
  assert.deepEqual(
    splitHighlightedSnippet("before <mark>match</mark> after"),
    [
      { text: "before ", highlighted: false },
      { text: "match", highlighted: true },
      { text: " after", highlighted: false },
    ]
  );
});

test("treats embedded html as plain text", () => {
  assert.deepEqual(
    splitHighlightedSnippet("<img onerror=alert(1)> <mark>needle</mark>"),
    [
      { text: "<img onerror=alert(1)> ", highlighted: false },
      { text: "needle", highlighted: true },
    ]
  );
});
