import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const webDir = path.join(repoRoot, 'apps', 'web');

const preloadSource = String.raw`
const net = require('node:net');
const tls = require('node:tls');

const allowedHosts = new Set(['127.0.0.1', '::1', 'localhost', '0.0.0.0']);

function normalizeHost(args) {
  if (!args.length) return undefined;
  const first = args[0];
  if (typeof first === 'object' && first) return first.host || first.hostname;
  if (typeof first === 'number') {
    const second = args[1];
    if (typeof second === 'string') return second;
    if (second && typeof second === 'object') return second.host || second.hostname;
    return undefined;
  }
  if (typeof first === 'string') return first;
  return undefined;
}

function isAllowedHost(host) {
  if (!host) return true;
  if (allowedHosts.has(host)) return true;
  if (host.startsWith('127.')) return true;
  if (host === '::ffff:127.0.0.1') return true;
  return false;
}

function wrapConnect(original, label) {
  return function wrappedConnect(...args) {
    const host = normalizeHost(args);
    if (!isAllowedHost(host)) {
      const err = new Error('[cchistory/offline-web-build] blocked external ' + label + ' connection to ' + host);
      const cb = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : undefined;
      if (cb) process.nextTick(() => cb(err));
      const socket = new net.Socket();
      process.nextTick(() => socket.emit('error', err));
      return socket;
    }
    return original.apply(this, args);
  };
}

net.connect = wrapConnect(net.connect, 'net');
net.createConnection = wrapConnect(net.createConnection, 'net');
tls.connect = wrapConnect(tls.connect, 'tls');
`;

async function main() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'cchistory-web-offline-'));
  const preloadPath = path.join(tempDir, 'block-external-net.cjs');
  await writeFile(preloadPath, preloadSource, 'utf8');

  try {
    await rm(path.join(webDir, '.next'), { recursive: true, force: true });
    console.log('[cchistory] removed apps/web/.next before offline verification');
    await runBuild(preloadPath);
    console.log('[cchistory] offline web build verification passed');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function runBuild(preloadPath) {
  return new Promise((resolve, reject) => {
    const inheritedNodeOptions = process.env.NODE_OPTIONS?.trim();
    const nodeOptions = [`--require ${preloadPath}`, '--max-old-space-size=1536'];
    if (inheritedNodeOptions) {
      nodeOptions.push(inheritedNodeOptions);
    }

    const child = spawn('pnpm', ['build'], {
      cwd: webDir,
      env: {
        ...process.env,
        NODE_OPTIONS: nodeOptions.join(' '),
      },
      stdio: 'inherit',
    });

    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`pnpm build exited with code ${code ?? 'null'}${signal ? ` (signal ${signal})` : ''}`));
    });
    child.on('error', reject);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

