import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { listPlatformAdapters, listPlatformAdaptersBySupportTier } from "../platforms/registry.js";
import { getRepoMockDataRoot, readStableAdapterValidationManifest, readJsonFixture } from "../test-helpers.js";
import type { MockDataScenarioFixture } from "../test-helpers.js";

test("platform adapter registry provides exactly one adapter per supported platform", () => {
  const adapters = listPlatformAdapters();
  const platforms = adapters.map((adapter) => adapter.platform).sort();

  assert.deepEqual(platforms, [
    "accio",
    "amp",
    "antigravity",
    "claude_code",
    "codebuddy",
    "codex",
    "cursor",
    "factory_droid",
    "gemini",
    "lobechat",
    "openclaw",
    "opencode",
  ]);
  assert.equal(new Set(platforms).size, adapters.length);
});

test("platform adapter registry distinguishes stable and experimental support tiers", () => {
  const stablePlatforms = listPlatformAdaptersBySupportTier("stable")
    .map((adapter) => adapter.platform)
    .sort();
  const experimentalPlatforms = listPlatformAdaptersBySupportTier("experimental")
    .map((adapter) => adapter.platform)
    .sort();

  assert.deepEqual(stablePlatforms, [
    "amp",
    "antigravity",
    "claude_code",
    "codebuddy",
    "codex",
    "cursor",
    "factory_droid",
    "gemini",
    "openclaw",
    "opencode",
  ]);
  assert.deepEqual(experimentalPlatforms, ["accio", "lobechat"]);
});

test("stable support tier is backed by documented real-world validation assets", async () => {
  const mockDataRoot = getRepoMockDataRoot();
  const manifest = await readStableAdapterValidationManifest();
  const scenarios = await readJsonFixture<MockDataScenarioFixture[]>(path.join(mockDataRoot, "scenarios.json"));
  const scenarioIds = new Set(scenarios.map((scenario) => scenario.id));
  const manifestPlatforms = manifest.stable_adapters.map((entry) => entry.platform).sort();
  const stablePlatforms = listPlatformAdaptersBySupportTier("stable")
    .map((adapter) => adapter.platform)
    .sort();
  const experimentalPlatforms = listPlatformAdaptersBySupportTier("experimental")
    .map((adapter) => adapter.platform)
    .sort();

  assert.equal(manifest.schema_version, 1);
  assert.match(manifest.last_reviewed, /^\d{4}-\d{2}-\d{2}$/u);
  assert.deepEqual(manifestPlatforms, stablePlatforms);

  for (const platform of experimentalPlatforms) {
    assert.equal(manifestPlatforms.includes(platform), false, `did not expect experimental ${platform} in stable manifest`);
  }

  for (const entry of manifest.stable_adapters) {
    assert.ok(entry.scenario_ids.length >= 1, `expected scenario coverage for ${entry.platform}`);
    assert.ok(entry.validation_basis.length >= 1, `expected validation basis for ${entry.platform}`);
    await access(path.join(mockDataRoot, entry.probe_base_dir));

    for (const scenarioId of entry.scenario_ids) {
      assert.ok(scenarioIds.has(scenarioId), `expected scenario ${scenarioId} for ${entry.platform}`);
    }

    for (const fixturePath of entry.runtime_fixture_paths ?? []) {
      await access(path.join(mockDataRoot, fixturePath));
    }
  }
});
