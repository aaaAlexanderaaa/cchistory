import assert from "node:assert/strict";
import { test } from "node:test";
import { localPathIdentitiesMatch, normalizeLocalPathIdentity } from "./index.js";

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
