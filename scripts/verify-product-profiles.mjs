import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootPackage = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
const scripts = rootPackage.scripts ?? {};
const phases = ['build', 'test', 'release'];
const profiles = ['full', 'lite', 'managed', 'agent-extension'];
const findings = [];

for (const phase of phases) {
  for (const profile of profiles) {
    const name = `${phase}:${profile}`;
    if (!scripts[name]) findings.push(`missing root profile script ${name}`);
  }
  const aggregate = scripts[`${phase}:aggregate`] ?? '';
  for (const profile of profiles) {
    if (!aggregate.includes(`${phase}:${profile}`)) {
      findings.push(`${phase}:aggregate does not include ${phase}:${profile}`);
    }
  }
}

if (scripts.build !== 'pnpm run build:full') {
  findings.push('root build must select the Full profile rather than aggregate unrelated products');
}
if (scripts.test !== 'pnpm run test:full') {
  findings.push('root test must select the Full profile rather than aggregate unrelated products');
}
const ci = await readFile(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
for (const gate of [
  'pnpm run verify:lite',
  'pnpm run verify:lite-artifact',
  'pnpm run build:managed',
  'pnpm run test:managed',
  'pnpm run test:agent-extension',
]) {
  if (!ci.includes(gate)) findings.push(`CI is missing profile gate: ${gate}`);
}
if (!scripts['release:lite']?.includes('verify:lite-artifact')) {
  findings.push('Lite release profile does not verify the standalone artifact closure');
}
if (!scripts['test:managed']?.includes('@cchistory/web test')) {
  findings.push('Managed test profile does not run Web regression tests');
}
if (scripts['test:core']?.includes('@cchistory/api-client test')) {
  findings.push('Full/Core test profile must not run Managed API-client integrations');
}
if (!scripts['test:managed']?.includes('@cchistory/api-client test')) {
  findings.push('Managed test profile does not run API-client integration tests');
}

const cliPackage = JSON.parse(await readFile(path.join(repoRoot, 'apps', 'cli', 'package.json'), 'utf8'));
const cliTestEntry = await readFile(path.join(repoRoot, 'apps', 'cli', 'src', 'index.test.ts'), 'utf8');
const cliFullTestConfig = JSON.parse(await readFile(path.join(repoRoot, 'apps', 'cli', 'tsconfig.test.json'), 'utf8'));
if (cliTestEntry.includes('commands-agent.test')) {
  findings.push('Full CLI test entrypoint must not import Agent-extension-only tests');
}
if (!cliFullTestConfig.exclude?.includes('src/test/commands-agent.test.ts')) {
  findings.push('Full CLI test compilation must exclude Agent-extension-only tests');
}
if (!cliPackage.scripts?.['test:agent-extension']?.includes('dist/test/commands-agent.test.js')) {
  findings.push('Agent-extension test profile does not run the remote-agent CLI suite');
}
if (!cliPackage.scripts?.['test:agent-extension']?.includes('tsconfig.test.agent-extension.json')) {
  findings.push('Agent-extension test profile does not compile its isolated CLI suite');
}

if (findings.length > 0) {
  console.error('[cchistory] product-profile verification failed');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log('[cchistory] product-profile verification passed');
  console.log('[cchistory] verified independent Full, Lite, Managed, Agent extension, and aggregate gates');
}
