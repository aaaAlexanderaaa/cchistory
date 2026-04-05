import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  decodeUriPath,
  deriveHostId,
  deriveSourceInstanceId,
  deriveSourceSlotId,
  getLocalPathBasename,
  isLegacySourceInstanceId,
  localPathIdentitiesMatch,
  maxIso,
  minIso,
  normalizeLocalPathIdentity,
  normalizeSourceBaseDir,
  nowIso,
  stableId,
} from "./index.js";

// ===================================================================
// Existing tests (preserved)
// ===================================================================

test("normalizeLocalPathIdentity preserves UNC authority for raw and file-URI forms", () => {
  assert.equal(normalizeLocalPathIdentity("\\\\server\\share\\project\\"), "//server/share/project");
  assert.equal(normalizeLocalPathIdentity("file://server/share/project/"), "//server/share/project");
  assert.equal(normalizeLocalPathIdentity("file://server/share/folder%20name"), "//server/share/folder name");
});

test("localPathIdentitiesMatch treats UNC raw paths and file URIs as equivalent", () => {
  assert.equal(
    localPathIdentitiesMatch("\\\\server\\share\\project", "file://server/share/project/"),
    true,
  );
});

test("normalizeSourceBaseDir strips file:/// prefix to match normalizeLocalPathIdentity", () => {
  assert.equal(
    normalizeSourceBaseDir("file:///Users/alex/.codex/sessions"),
    "/Users/alex/.codex/sessions",
  );
  assert.equal(
    normalizeSourceBaseDir("/Users/alex/.codex/sessions"),
    "/Users/alex/.codex/sessions",
  );
  // Both forms should produce identical results
  assert.equal(
    normalizeSourceBaseDir("file:///Users/alex/.codex/sessions"),
    normalizeSourceBaseDir("/Users/alex/.codex/sessions"),
  );
});

test("deriveSourceInstanceId produces the same ID for file:/// and plain path forms", () => {
  const input = { host_id: "host-test", slot_id: "codex" };
  const idFromPlain = deriveSourceInstanceId({ ...input, base_dir: "/Users/alex/.codex/sessions" });
  const idFromUri = deriveSourceInstanceId({ ...input, base_dir: "file:///Users/alex/.codex/sessions" });
  assert.equal(idFromPlain, idFromUri);
});

// ===================================================================
// stableId — deterministic SHA-1 content-addressable hashing
// ===================================================================

describe("stableId", () => {
  test("returns a 40-char hex string (SHA-1)", () => {
    const id = stableId("hello");
    assert.match(id, /^[0-9a-f]{40}$/);
  });

  test("is deterministic across calls", () => {
    assert.equal(stableId("a", "b", "c"), stableId("a", "b", "c"));
  });

  test("different inputs produce different hashes", () => {
    assert.notEqual(stableId("a", "b"), stableId("b", "a"));
    assert.notEqual(stableId("a"), stableId("b"));
  });

  test("concatenates parts with :: separator", () => {
    // stableId("a", "b") should differ from stableId("a:b") because
    // the former joins as "a::b" whereas the latter is just "a:b"
    assert.notEqual(stableId("a", "b"), stableId("a:b"));
  });

  test("handles empty string parts", () => {
    const id = stableId("");
    assert.match(id, /^[0-9a-f]{40}$/);
    assert.notEqual(stableId(""), stableId("x"));
  });

  test("handles no arguments (empty join)", () => {
    const id = stableId();
    assert.match(id, /^[0-9a-f]{40}$/);
  });
});

// ===================================================================
// deriveHostId
// ===================================================================

describe("deriveHostId", () => {
  test("produces host- prefix", () => {
    const id = deriveHostId("MyMachine");
    assert.ok(id.startsWith("host-"));
  });

  test("is deterministic", () => {
    assert.equal(deriveHostId("MyMachine"), deriveHostId("MyMachine"));
  });

  test("trims whitespace", () => {
    assert.equal(deriveHostId("  MyMachine  "), deriveHostId("MyMachine"));
  });

  test("lowercases hostname", () => {
    assert.equal(deriveHostId("MYMACHINE"), deriveHostId("mymachine"));
    assert.equal(deriveHostId("MyMachine"), deriveHostId("mymachine"));
  });

  test("different hostnames produce different IDs", () => {
    assert.notEqual(deriveHostId("alpha"), deriveHostId("beta"));
  });

  test("handles empty string", () => {
    // Should still produce a valid host-<hash> string
    const id = deriveHostId("");
    assert.ok(id.startsWith("host-"));
    assert.match(id, /^host-[0-9a-f]+$/);
  });
});

// ===================================================================
// deriveSourceSlotId
// ===================================================================

describe("deriveSourceSlotId", () => {
  test("returns the platform string as-is", () => {
    assert.equal(deriveSourceSlotId("claude_code"), "claude_code");
    assert.equal(deriveSourceSlotId("codex"), "codex");
    assert.equal(deriveSourceSlotId("cursor"), "cursor");
    assert.equal(deriveSourceSlotId("other"), "other");
  });
});

// ===================================================================
// deriveSourceInstanceId
// ===================================================================

describe("deriveSourceInstanceId", () => {
  test("produces srcinst- prefix with slot_id", () => {
    const id = deriveSourceInstanceId({
      host_id: "host-abc",
      slot_id: "claude_code",
      base_dir: "/Users/test/.claude",
    });
    assert.ok(id.startsWith("srcinst-claude_code-"));
  });

  test("is deterministic", () => {
    const input = { host_id: "host-abc", slot_id: "codex", base_dir: "/tmp/sessions" };
    assert.equal(deriveSourceInstanceId(input), deriveSourceInstanceId(input));
  });

  test("different host_ids produce different instance IDs", () => {
    const base = { slot_id: "codex", base_dir: "/tmp" };
    assert.notEqual(
      deriveSourceInstanceId({ ...base, host_id: "host-a" }),
      deriveSourceInstanceId({ ...base, host_id: "host-b" }),
    );
  });

  test("different base_dirs produce different instance IDs", () => {
    const base = { host_id: "host-a", slot_id: "codex" };
    assert.notEqual(
      deriveSourceInstanceId({ ...base, base_dir: "/path/one" }),
      deriveSourceInstanceId({ ...base, base_dir: "/path/two" }),
    );
  });

  test("normalizes base_dir (trailing slash equivalence)", () => {
    const base = { host_id: "host-a", slot_id: "codex" };
    assert.equal(
      deriveSourceInstanceId({ ...base, base_dir: "/Users/test/sessions/" }),
      deriveSourceInstanceId({ ...base, base_dir: "/Users/test/sessions" }),
    );
  });

  test("normalizes Windows base_dir", () => {
    const base = { host_id: "host-a", slot_id: "codex" };
    assert.equal(
      deriveSourceInstanceId({ ...base, base_dir: "C:\\Users\\test\\sessions" }),
      deriveSourceInstanceId({ ...base, base_dir: "c:/Users/test/sessions" }),
    );
  });
});

// ===================================================================
// isLegacySourceInstanceId
// ===================================================================

describe("isLegacySourceInstanceId", () => {
  test("returns true for src- prefix", () => {
    assert.equal(isLegacySourceInstanceId("src-abc123"), true);
  });

  test("returns false for srcinst- prefix", () => {
    assert.equal(isLegacySourceInstanceId("srcinst-codex-abc123"), false);
  });

  test("returns false for other prefixes", () => {
    assert.equal(isLegacySourceInstanceId("host-abc"), false);
    assert.equal(isLegacySourceInstanceId(""), false);
  });
});

// ===================================================================
// decodeUriPath
// ===================================================================

describe("decodeUriPath", () => {
  test("decodes percent-encoded spaces", () => {
    assert.equal(decodeUriPath("/path/to/my%20folder"), "/path/to/my folder");
  });

  test("decodes multiple encoded characters", () => {
    assert.equal(decodeUriPath("/a%20b%2Fc%23d"), "/a b/c#d");
  });

  test("returns original string if no percent-encoding", () => {
    const plain = "/Users/test/projects";
    assert.equal(decodeUriPath(plain), plain);
  });

  test("returns original string on invalid encoding", () => {
    // %ZZ is not valid percent encoding — decodeURIComponent will throw
    const bad = "/path/%ZZ/foo";
    assert.equal(decodeUriPath(bad), bad);
  });

  test("handles empty string", () => {
    assert.equal(decodeUriPath(""), "");
  });

  test("decodes full file URI percent-encoded path", () => {
    assert.equal(
      decodeUriPath("file:///Users/test/my%20project"),
      "file:///Users/test/my project",
    );
  });
});

// ===================================================================
// normalizeLocalPathIdentity — full matrix
// ===================================================================

describe("normalizeLocalPathIdentity", () => {
  // --- undefined / empty ---
  test("returns undefined for undefined", () => {
    assert.equal(normalizeLocalPathIdentity(undefined), undefined);
  });

  test("returns undefined for empty string", () => {
    assert.equal(normalizeLocalPathIdentity(""), undefined);
  });

  test("returns undefined for whitespace-only string", () => {
    assert.equal(normalizeLocalPathIdentity("   "), undefined);
  });

  // --- Unix paths ---
  test("normalizes simple Unix path", () => {
    assert.equal(normalizeLocalPathIdentity("/Users/test/project"), "/Users/test/project");
  });

  test("strips trailing slash from Unix path", () => {
    assert.equal(normalizeLocalPathIdentity("/Users/test/project/"), "/Users/test/project");
  });

  test("collapses double slashes", () => {
    assert.equal(normalizeLocalPathIdentity("/Users//test///project"), "/Users/test/project");
  });

  test("resolves . and .. segments", () => {
    assert.equal(normalizeLocalPathIdentity("/Users/test/./project/../other"), "/Users/test/other");
  });

  test("preserves root path /", () => {
    assert.equal(normalizeLocalPathIdentity("/"), "/");
  });

  // --- Windows paths ---
  test("normalizes Windows backslash path", () => {
    assert.equal(normalizeLocalPathIdentity("C:\\Users\\test\\project"), "c:/Users/test/project");
  });

  test("lowercases Windows drive letter", () => {
    assert.equal(normalizeLocalPathIdentity("D:\\Data"), "d:/Data");
  });

  test("normalizes Windows path with forward slashes", () => {
    assert.equal(normalizeLocalPathIdentity("C:/Users/test"), "c:/Users/test");
  });

  test("strips trailing slash from Windows path", () => {
    assert.equal(normalizeLocalPathIdentity("C:\\Users\\test\\"), "c:/Users/test");
  });

  test("collapses double slashes in Windows path", () => {
    assert.equal(normalizeLocalPathIdentity("C:\\\\Users\\\\test"), "c:/Users/test");
  });

  test("handles mixed separators in Windows path", () => {
    assert.equal(normalizeLocalPathIdentity("C:\\Users/test\\project"), "c:/Users/test/project");
  });

  // --- UNC paths ---
  test("normalizes raw UNC path", () => {
    assert.equal(normalizeLocalPathIdentity("\\\\server\\share\\folder"), "//server/share/folder");
  });

  test("strips trailing slash from UNC path", () => {
    assert.equal(normalizeLocalPathIdentity("\\\\server\\share\\folder\\"), "//server/share/folder");
  });

  // --- file:// URIs ---
  test("strips file:/// prefix (Mac/Linux)", () => {
    assert.equal(normalizeLocalPathIdentity("file:///Users/test/project"), "/Users/test/project");
  });

  test("strips file:///C:/ prefix (Windows file URI)", () => {
    assert.equal(normalizeLocalPathIdentity("file:///C:/Users/test"), "c:/Users/test");
  });

  test("strips file:///c:/ prefix (lowercase drive in URI)", () => {
    assert.equal(normalizeLocalPathIdentity("file:///c:/Users/test"), "c:/Users/test");
  });

  test("handles file://C:/ (drive letter as authority)", () => {
    assert.equal(normalizeLocalPathIdentity("file://C:/Users/test"), "c:/Users/test");
  });

  test("handles file://localhost/ prefix", () => {
    assert.equal(normalizeLocalPathIdentity("file://localhost/Users/test"), "/Users/test");
  });

  test("handles file://localhost/C:/ prefix", () => {
    assert.equal(normalizeLocalPathIdentity("file://localhost/C:/Users/test"), "c:/Users/test");
  });

  // --- percent-encoded paths ---
  test("decodes percent-encoded spaces in path", () => {
    assert.equal(normalizeLocalPathIdentity("/Users/test/my%20project"), "/Users/test/my project");
  });

  test("decodes percent-encoded spaces in file URI", () => {
    assert.equal(
      normalizeLocalPathIdentity("file:///Users/test/my%20project"),
      "/Users/test/my project",
    );
  });

  test("handles paths with actual spaces", () => {
    assert.equal(normalizeLocalPathIdentity("/Users/test/my project"), "/Users/test/my project");
  });

  // --- leading /C: in URI ---
  test("strips leading slash before drive letter", () => {
    assert.equal(normalizeLocalPathIdentity("/C:/Users/test"), "c:/Users/test");
  });

  // --- trims whitespace ---
  test("trims leading and trailing whitespace", () => {
    assert.equal(normalizeLocalPathIdentity("  /Users/test  "), "/Users/test");
  });
});

// ===================================================================
// localPathIdentitiesMatch
// ===================================================================

describe("localPathIdentitiesMatch", () => {
  test("matches identical Unix paths", () => {
    assert.equal(localPathIdentitiesMatch("/Users/test", "/Users/test"), true);
  });

  test("matches plain path with file URI", () => {
    assert.equal(
      localPathIdentitiesMatch("/Users/test/project", "file:///Users/test/project"),
      true,
    );
  });

  test("matches Windows backslash with forward slash", () => {
    assert.equal(
      localPathIdentitiesMatch("C:\\Users\\test", "c:/Users/test"),
      true,
    );
  });

  test("matches Windows path with file URI", () => {
    assert.equal(
      localPathIdentitiesMatch("C:\\Users\\test", "file:///C:/Users/test"),
      true,
    );
  });

  test("matches path with trailing slash to one without", () => {
    assert.equal(
      localPathIdentitiesMatch("/Users/test/", "/Users/test"),
      true,
    );
  });

  test("matches percent-encoded path with plain path", () => {
    assert.equal(
      localPathIdentitiesMatch("/Users/test/my%20project", "/Users/test/my project"),
      true,
    );
  });

  test("does not match different paths", () => {
    assert.equal(localPathIdentitiesMatch("/Users/alpha", "/Users/beta"), false);
  });

  test("returns false when left is undefined", () => {
    assert.equal(localPathIdentitiesMatch(undefined, "/test"), false);
  });

  test("returns false when right is undefined", () => {
    assert.equal(localPathIdentitiesMatch("/test", undefined), false);
  });

  test("returns false when both are undefined", () => {
    assert.equal(localPathIdentitiesMatch(undefined, undefined), false);
  });

  test("returns false when both are empty", () => {
    assert.equal(localPathIdentitiesMatch("", ""), false);
  });

  test("matches case-insensitive drive letters", () => {
    assert.equal(
      localPathIdentitiesMatch("C:/Users/test", "c:/Users/test"),
      true,
    );
  });
});

// ===================================================================
// getLocalPathBasename
// ===================================================================

describe("getLocalPathBasename", () => {
  test("returns the last path component for Unix path", () => {
    assert.equal(getLocalPathBasename("/Users/test/project"), "project");
  });

  test("returns the last path component for Windows path", () => {
    assert.equal(getLocalPathBasename("C:\\Users\\test\\project"), "project");
  });

  test("returns the last component for file URI", () => {
    assert.equal(getLocalPathBasename("file:///Users/test/project"), "project");
  });

  test("returns undefined for undefined input", () => {
    assert.equal(getLocalPathBasename(undefined), undefined);
  });

  test("returns undefined for empty string", () => {
    assert.equal(getLocalPathBasename(""), undefined);
  });

  test("handles path with trailing slash", () => {
    assert.equal(getLocalPathBasename("/Users/test/project/"), "project");
  });

  test("handles path with spaces", () => {
    assert.equal(getLocalPathBasename("/Users/test/my project"), "my project");
  });

  test("handles percent-encoded basename", () => {
    assert.equal(getLocalPathBasename("/Users/test/my%20project"), "my project");
  });
});

// ===================================================================
// normalizeSourceBaseDir
// ===================================================================

describe("normalizeSourceBaseDir", () => {
  test("normalizes Unix path", () => {
    assert.equal(normalizeSourceBaseDir("/Users/test/sessions"), "/Users/test/sessions");
  });

  test("normalizes Windows path with backslashes", () => {
    assert.equal(normalizeSourceBaseDir("C:\\Users\\test\\sessions"), "c:/Users/test/sessions");
  });

  test("lowers Windows drive letter", () => {
    assert.equal(normalizeSourceBaseDir("D:\\Data"), "d:/Data");
  });

  test("strips trailing slash", () => {
    assert.equal(normalizeSourceBaseDir("/Users/test/sessions/"), "/Users/test/sessions");
  });

  test("collapses double slashes", () => {
    assert.equal(normalizeSourceBaseDir("/Users//test///sessions"), "/Users/test/sessions");
  });

  test("strips file:/// prefix", () => {
    assert.equal(normalizeSourceBaseDir("file:///Users/test/sessions"), "/Users/test/sessions");
  });

  test("Windows file URI normalization", () => {
    assert.equal(normalizeSourceBaseDir("file:///C:/Users/test"), "c:/Users/test");
  });

  test("handles percent-encoded spaces", () => {
    assert.equal(normalizeSourceBaseDir("/Users/test/my%20sessions"), "/Users/test/my sessions");
  });
});

// ===================================================================
// nowIso
// ===================================================================

describe("nowIso", () => {
  test("returns a valid ISO-8601 string", () => {
    const iso = nowIso();
    // Should be parseable and not NaN
    assert.ok(!Number.isNaN(Date.parse(iso)));
  });

  test("returns a string ending with Z (UTC)", () => {
    const iso = nowIso();
    assert.ok(iso.endsWith("Z"));
  });

  test("returns approximately the current time", () => {
    const before = Date.now();
    const iso = nowIso();
    const after = Date.now();
    const parsed = Date.parse(iso);
    assert.ok(parsed >= before - 1000 && parsed <= after + 1000);
  });
});

// ===================================================================
// minIso / maxIso
// ===================================================================

describe("minIso", () => {
  test("returns the earlier timestamp", () => {
    assert.equal(
      minIso("2024-01-01T00:00:00Z", "2024-06-01T00:00:00Z"),
      "2024-01-01T00:00:00Z",
    );
  });

  test("returns right when left is undefined", () => {
    assert.equal(minIso(undefined, "2024-01-01T00:00:00Z"), "2024-01-01T00:00:00Z");
  });

  test("returns left when right is undefined", () => {
    assert.equal(minIso("2024-01-01T00:00:00Z", undefined), "2024-01-01T00:00:00Z");
  });

  test("returns undefined when both are undefined", () => {
    assert.equal(minIso(undefined, undefined), undefined);
  });

  test("returns either when both are equal", () => {
    const ts = "2024-01-01T00:00:00Z";
    assert.equal(minIso(ts, ts), ts);
  });
});

describe("maxIso", () => {
  test("returns the later timestamp", () => {
    assert.equal(
      maxIso("2024-01-01T00:00:00Z", "2024-06-01T00:00:00Z"),
      "2024-06-01T00:00:00Z",
    );
  });

  test("returns right when left is undefined", () => {
    assert.equal(maxIso(undefined, "2024-06-01T00:00:00Z"), "2024-06-01T00:00:00Z");
  });

  test("returns left when right is undefined", () => {
    assert.equal(maxIso("2024-06-01T00:00:00Z", undefined), "2024-06-01T00:00:00Z");
  });

  test("returns undefined when both are undefined", () => {
    assert.equal(maxIso(undefined, undefined), undefined);
  });

  test("returns either when both are equal", () => {
    const ts = "2024-06-01T00:00:00Z";
    assert.equal(maxIso(ts, ts), ts);
  });
});
