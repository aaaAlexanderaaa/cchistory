import { hostname } from 'node:os'
import { fileURLToPath } from 'node:url'

const localHostname = hostname()
const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url))

const allowedDevOrigins = [
  'localhost',
  'localhost:8085',
  '127.0.0.1',
  '127.0.0.1:8085',
  '0.0.0.0',
  '0.0.0.0:8085',
  localHostname,
  `${localHostname}:8085`,
  process.env.CCHISTORY_PUBLIC_WEB_ORIGIN,
  ...(process.env.CCHISTORY_ALLOWED_DEV_ORIGINS?.split(',') ?? []),
]
  .map((value) => value?.trim())
  .filter(Boolean)
  .map((value) => value.replace(/^https?:\/\//, '').replace(/\/$/, ''))
  .filter((value, index, values) => values.indexOf(value) === index)

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins,
  outputFileTracingRoot: workspaceRoot,
  // React Compiler disabled - not needed for this prototype
  async rewrites() {
    const internalApiOrigin = process.env.CCHISTORY_INTERNAL_API_ORIGIN || 'http://127.0.0.1:8040';

    return [
      {
        source: '/api/cchistory/:path*',
        destination: `${internalApiOrigin}/:path*`,
      },
    ];
  },
};

export default nextConfig;
