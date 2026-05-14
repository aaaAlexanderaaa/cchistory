import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const apiRouteFiles = [
  'apps/api/src/app.ts',
  'apps/api/src/routes/agents.ts',
  'apps/api/src/routes/data.ts',
  'apps/api/src/routes/sources.ts',
];
const httpMethods = ['get', 'post', 'put', 'delete', 'patch'];

async function main() {
  const routeSet = await readApiRouteSet();
  const openApiSet = await readOpenApiRouteSet();
  const findings = [
    ...compareSet('OpenAPI path inventory', openApiSet, routeSet),
  ];

  if (findings.length > 0) {
    console.error('[cchistory] runtime-inventory verification failed');
    for (const finding of findings) {
      console.error(`- ${finding}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('[cchistory] runtime-inventory verification passed');
  console.log('[cchistory] verified API route registrations against apps/api/src/utils/openapi.ts');
}

async function readApiRouteSet() {
  const routes = new Set();
  for (const relPath of apiRouteFiles) {
    const text = await readRepoText(relPath);
    for (const match of text.matchAll(/app\.(get|post|put|delete|patch)\(\s*"([^"]+)"/g)) {
      routes.add(`${match[1].toUpperCase()} ${normalizeRoutePath(match[2])}`);
    }
  }
  return routes;
}

async function readOpenApiRouteSet() {
  const text = await readRepoText('apps/api/src/utils/openapi.ts');
  const routes = new Set();
  let currentPath;
  for (const line of text.split(/\r?\n/)) {
    const pathMatch = line.match(/^\s*"([^"]+)":\s*\{/);
    if (pathMatch && pathMatch[1].startsWith('/')) {
      currentPath = pathMatch[1];
    }
    if (!currentPath) {
      continue;
    }
    for (const method of httpMethods) {
      if (new RegExp(`\\b${method}\\s*:`).test(line)) {
        routes.add(`${method.toUpperCase()} ${currentPath}`);
      }
    }
  }
  return routes;
}

async function readRepoText(relPath) {
  return readFile(path.join(repoRoot, relPath), 'utf8');
}

function normalizeRoutePath(routePath) {
  return routePath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function compareSet(label, actual, expected) {
  const findings = [];
  for (const route of [...expected].sort()) {
    if (!actual.has(route)) {
      findings.push(`${label}: missing ${route}`);
    }
  }
  for (const route of [...actual].sort()) {
    if (!expected.has(route)) {
      findings.push(`${label}: unexpected ${route}`);
    }
  }
  return findings;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
