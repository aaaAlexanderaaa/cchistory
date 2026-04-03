import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const platformLabelToId = new Map([
  ['Codex', 'codex'],
  ['Claude Code', 'claude_code'],
  ['Cursor', 'cursor'],
  ['AMP', 'amp'],
  ['Factory Droid', 'factory_droid'],
  ['Antigravity', 'antigravity'],
  ['Gemini CLI', 'gemini'],
  ['Gemini', 'gemini'],
  ['OpenClaw', 'openclaw'],
  ['OpenCode', 'opencode'],
  ['LobeChat', 'lobechat'],
  ['CodeBuddy', 'codebuddy'],
  ['codebuddy', 'codebuddy'],
  ['codex', 'codex'],
  ['claude_code', 'claude_code'],
  ['cursor', 'cursor'],
  ['amp', 'amp'],
  ['factory_droid', 'factory_droid'],
  ['antigravity', 'antigravity'],
  ['gemini', 'gemini'],
  ['openclaw', 'openclaw'],
  ['opencode', 'opencode'],
  ['lobechat', 'lobechat'],
]);

async function main() {
  const registryTiers = await readRegistryTiers();
  const findings = [
    ...compareTierMaps('README.md', await readReadmeTierMap('README.md'), registryTiers),
    ...compareTierMaps('README_CN.md', await readReadmeTierMap('README_CN.md'), registryTiers),
    ...compareTierMaps(
      'docs/design/CURRENT_RUNTIME_SURFACE.md',
      await readRuntimeSurfaceTierMap(),
      registryTiers,
    ),
    ...compareBucketMap(
      'docs/design/SELF_HOST_V1_RELEASE_GATE.md',
      await readReleaseGateTierBuckets(),
      registryTiers,
    ),
    ...compareSet(
      'docs/sources/README.md stable sources',
      await readSourcesStableSet(),
      getRegistryPlatformsByTier(registryTiers, 'stable'),
    ),
    ...compareSet(
      'docs/sources/README.md experimental exclusions',
      await readSourcesExperimentalSet(),
      getRegistryPlatformsByTier(registryTiers, 'experimental'),
    ),
  ];

  if (findings.length > 0) {
    console.error('[cchistory] support-status verification failed');
    for (const finding of findings) {
      console.error(`- ${finding}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('[cchistory] support-status verification passed');
  console.log('[cchistory] verified README.md, README_CN.md, docs/design/CURRENT_RUNTIME_SURFACE.md, docs/design/SELF_HOST_V1_RELEASE_GATE.md, docs/sources/README.md');
}

async function readRegistryTiers() {
  const platformsDir = path.join(repoRoot, 'packages', 'source-adapters', 'src', 'platforms');
  const entries = await readdir(platformsDir, { withFileTypes: true });
  const tiers = new Map();

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) {
      continue;
    }

    const filePath = path.join(platformsDir, entry.name);
    const text = await readFile(filePath, 'utf8');
    const platformMatch = text.match(/platform:\s*"([a-z_]+)"/);
    const tierMatch = text.match(/supportTier:\s*"(stable|experimental)"/);
    if (!platformMatch || !tierMatch) {
      continue;
    }

    tiers.set(platformMatch[1], tierMatch[1]);
  }

  if (tiers.size === 0) {
    throw new Error('could not read any adapter support tiers from packages/source-adapters/src/platforms/*.ts');
  }

  return tiers;
}

async function readReadmeTierMap(relPath) {
  const text = await readRepoText(relPath);
  const headerLine = relPath === 'README.md'
    ? '| Platform | Self-host v1 Tier | Source Location |'
    : '| 平台 | Self-host v1 分级 | 数据源位置 |';
  const rows = extractMarkdownTableRows(text, headerLine, relPath);
  return buildTierMap(rows, 0, 1, relPath);
}

async function readRuntimeSurfaceTierMap() {
  const relPath = 'docs/design/CURRENT_RUNTIME_SURFACE.md';
  const text = await readRepoText(relPath);
  const rows = extractMarkdownTableRows(text, '| Platform | Family | Self-host v1 tier | Notes |', relPath);
  return buildTierMap(rows, 0, 2, relPath);
}

async function readReleaseGateTierBuckets() {
  const relPath = 'docs/design/SELF_HOST_V1_RELEASE_GATE.md';
  const text = await readRepoText(relPath);
  const rows = extractMarkdownTableRows(text, '| Tier | Platforms | Meaning |', relPath);
  const buckets = new Map();

  for (const row of rows) {
    const tier = normalizeTierLabel(row[0], relPath);
    const platforms = [...row[1].matchAll(/`([^`]+)`/g)].map((match) => normalizePlatformLabel(match[1], relPath));
    buckets.set(tier, new Set(platforms));
  }

  return buckets;
}

async function readSourcesStableSet() {
  const relPath = 'docs/sources/README.md';
  const text = await readRepoText(relPath);
  const rows = extractMarkdownTableRows(text, '| Source | Family | 主要入口 | 文档 |', relPath);
  return new Set(rows.map((row) => normalizePlatformLabel(row[0], relPath)));
}

async function readSourcesExperimentalSet() {
  const relPath = 'docs/sources/README.md';
  const text = await readRepoText(relPath);
  const lines = text.split(/\r?\n/);
  const experimental = [];
  let collecting = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!collecting) {
      if (trimmed.includes('暂未收录到本目录的 source')) {
        collecting = true;
      }
      continue;
    }

    if (trimmed.startsWith('- ')) {
      experimental.push(normalizePlatformLabel(trimmed.slice(2), relPath));
      continue;
    }

    if (experimental.length > 0 && !trimmed) {
      break;
    }
  }

  if (experimental.length === 0) {
    throw new Error(`${relPath}: could not find experimental source exclusion list`);
  }

  return new Set(experimental);
}

async function readRepoText(relPath) {
  return readFile(path.join(repoRoot, relPath), 'utf8');
}

function extractMarkdownTableRows(text, headerLine, relPath) {
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim() === headerLine);
  if (headerIndex === -1) {
    throw new Error(`${relPath}: could not find table header ${headerLine}`);
  }

  const rows = [];
  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line.startsWith('|')) {
      break;
    }
    rows.push(parseMarkdownRow(line));
  }

  if (rows.length === 0) {
    throw new Error(`${relPath}: table ${headerLine} had no rows`);
  }

  return rows;
}

function parseMarkdownRow(line) {
  return line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function buildTierMap(rows, platformIndex, tierIndex, relPath) {
  const tierMap = new Map();

  for (const row of rows) {
    const platform = normalizePlatformLabel(row[platformIndex], relPath);
    const tier = normalizeTierLabel(row[tierIndex], relPath);
    tierMap.set(platform, tier);
  }

  return tierMap;
}

function normalizePlatformLabel(value, relPath) {
  const cleaned = value.replace(/[*`]/g, '').trim();
  const platformId = platformLabelToId.get(cleaned);
  if (!platformId) {
    throw new Error(`${relPath}: unknown platform label ${value}`);
  }
  return platformId;
}

function normalizeTierLabel(value, relPath) {
  const cleaned = value.replace(/[*`]/g, '').trim().toLowerCase();
  if (cleaned === 'stable' || cleaned === 'experimental') {
    return cleaned;
  }
  throw new Error(`${relPath}: unknown tier label ${value}`);
}

function getRegistryPlatformsByTier(registryTiers, tier) {
  return new Set(
    [...registryTiers.entries()]
      .filter(([, value]) => value === tier)
      .map(([platform]) => platform),
  );
}

function compareTierMaps(label, actual, expected) {
  const findings = [];
  findings.push(...compareSet(`${label} platform set`, new Set(actual.keys()), new Set(expected.keys())));

  for (const platform of new Set([...actual.keys(), ...expected.keys()])) {
    const actualTier = actual.get(platform);
    const expectedTier = expected.get(platform);
    if (actualTier !== expectedTier) {
      findings.push(`${label}: expected ${platform} to be ${expectedTier ?? 'missing'}, found ${actualTier ?? 'missing'}`);
    }
  }

  return findings;
}

function compareBucketMap(label, buckets, registryTiers) {
  const findings = [];
  findings.push(...compareSet(`${label} stable bucket`, buckets.get('stable') ?? new Set(), getRegistryPlatformsByTier(registryTiers, 'stable')));
  findings.push(...compareSet(`${label} experimental bucket`, buckets.get('experimental') ?? new Set(), getRegistryPlatformsByTier(registryTiers, 'experimental')));
  return findings;
}

function compareSet(label, actual, expected) {
  const findings = [];
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();

  for (const platform of expectedSorted) {
    if (!actual.has(platform)) {
      findings.push(`${label}: missing ${platform}`);
    }
  }

  for (const platform of actualSorted) {
    if (!expected.has(platform)) {
      findings.push(`${label}: unexpected ${platform}`);
    }
  }

  return findings;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
