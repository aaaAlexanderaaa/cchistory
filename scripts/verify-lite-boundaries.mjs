import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const liteRoots = ["@cchistory/live-runtime", "@cchistory/lite-cli", "@cchistory/lite-tui"];
const forbidden = new Set([
  "@cchistory/storage",
  "@cchistory/api-client",
  "@cchistory/cli",
  "@cchistory/tui",
  "@cchistory/api",
  "@cchistory/web",
]);

const packages = await readWorkspacePackages();
for (const rootName of liteRoots) {
  verifyProductionGraph(rootName, []);
}
for (const rootName of liteRoots) {
  const workspacePackage = packages.get(rootName);
  if (!workspacePackage) throw new Error(`Missing Lite workspace package: ${rootName}`);
  await verifySourceImports(path.join(workspacePackage.dir, "src"));
}

console.log("[cchistory] Lite dependency boundary verification passed");
console.log(`[cchistory] checked production roots: ${liteRoots.join(", ")}`);

async function readWorkspacePackages() {
  const result = new Map();
  for (const group of ["apps", "packages"]) {
    const groupDir = path.join(repoRoot, group);
    for (const entry of await readdir(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(groupDir, entry.name);
      try {
        const manifest = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"));
        result.set(manifest.name, { dir, manifest });
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") continue;
        throw error;
      }
    }
  }
  return result;
}

function verifyProductionGraph(packageName, chain) {
  if (chain.includes(packageName)) return;
  const workspacePackage = packages.get(packageName);
  if (!workspacePackage) return;
  const nextChain = [...chain, packageName];
  const dependencies = {
    ...(workspacePackage.manifest.dependencies ?? {}),
    ...(workspacePackage.manifest.optionalDependencies ?? {}),
  };
  for (const dependencyName of Object.keys(dependencies)) {
    if (forbidden.has(dependencyName)) {
      throw new Error(`Forbidden Lite production dependency: ${[...nextChain, dependencyName].join(" -> ")}`);
    }
    verifyProductionGraph(dependencyName, nextChain);
  }
}

async function verifySourceImports(sourceDir) {
  for (const filePath of await listTypeScriptFiles(sourceDir)) {
    if (filePath.endsWith(".test.ts")) continue;
    const source = await readFile(filePath, "utf8");
    for (const dependencyName of forbidden) {
      if (source.includes(`\"${dependencyName}`) || source.includes(`'${dependencyName}`)) {
        throw new Error(`Forbidden Lite production import ${dependencyName} in ${path.relative(repoRoot, filePath)}`);
      }
    }
  }
}

async function listTypeScriptFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listTypeScriptFiles(target));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(target);
  }
  return files;
}
