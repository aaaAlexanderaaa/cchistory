import assert from "node:assert/strict";
import test from "node:test";
import { KeyDecoder } from "./keys.js";

test("decodes printable characters, control chords, and Enter", () => {
  const decoder = new KeyDecoder();
  assert.deepEqual(decoder.push("jk"), [{ input: "j" }, { input: "k" }]);
  assert.deepEqual(decoder.push("\r"), [{ input: "", name: "return" }]);
  assert.deepEqual(decoder.push("\n"), [{ input: "", name: "return" }]);
  assert.deepEqual(decoder.push("\t"), [{ input: "", name: "tab" }]);
  assert.deepEqual(decoder.push("\x7f"), [{ input: "", name: "backspace" }]);
  assert.deepEqual(decoder.push("\x03"), [{ input: "c", ctrl: true }]);
});

test("decodes cursor, paging, and shift-tab sequences", () => {
  const decoder = new KeyDecoder();
  assert.deepEqual(decoder.push("\x1b[A\x1b[B\x1b[C\x1b[D"), [
    { input: "", name: "up" },
    { input: "", name: "down" },
    { input: "", name: "right" },
    { input: "", name: "left" },
  ]);
  assert.deepEqual(decoder.push("\x1b[5~\x1b[6~"), [
    { input: "", name: "pageup" },
    { input: "", name: "pagedown" },
  ]);
  assert.deepEqual(decoder.push("\x1b[Z"), [{ input: "", name: "tab", shift: true }]);
  assert.deepEqual(decoder.push("\x1b[1;2A"), [{ input: "", name: "up", shift: true }]);
  assert.deepEqual(decoder.push("\x1bOA"), [{ input: "", name: "up" }]);
});

test("reassembles escape sequences split across reads", () => {
  const decoder = new KeyDecoder();
  assert.deepEqual(decoder.push("\x1b"), []);
  assert.deepEqual(decoder.push("["), []);
  assert.deepEqual(decoder.push("B"), [{ input: "", name: "down" }]);
});

test("an escape followed by a normal key yields both, not an Alt chord", () => {
  const decoder = new KeyDecoder();
  assert.deepEqual(decoder.push("\x1bq"), [{ input: "", name: "escape" }, { input: "q" }]);
});

test("holds a lone escape until it is flushed, then reports it once", () => {
  const decoder = new KeyDecoder();
  assert.deepEqual(decoder.push("\x1b"), []);
  assert.equal(decoder.pending, "\x1b");
  assert.deepEqual(decoder.flushPendingEscape(), { input: "", name: "escape" });
  assert.equal(decoder.pending, "");
  assert.equal(decoder.flushPendingEscape(), undefined);
});

test("keeps multi-byte code points intact", () => {
  const decoder = new KeyDecoder();
  assert.deepEqual(decoder.push("解"), [{ input: "解" }]);
  assert.deepEqual(decoder.push("🙂"), [{ input: "🙂" }]);
});

test("drops an over-long unterminated escape sequence instead of stalling input", () => {
  const decoder = new KeyDecoder();
  assert.deepEqual(decoder.push(`\x1b[${"0".repeat(20)}`), []);
  assert.equal(decoder.pending, "");
});
