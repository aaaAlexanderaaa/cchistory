import { hostname, networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'

const localHostname = hostname()
const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url))

const localIPs = Object.values(networkInterfaces())
  .flat()
  .filter((iface) => iface && !iface.internal && iface.family === 'IPv4')
  .map((iface) => iface.address)

const allowedDevOrigins = [
  'localhost',
  'localhost:8085',
  '127.0.0.1',
  '127.0.0.1:8085',
  '0.0.0.0',
  '0.0.0.0:8085',
  localHostname,
  `${localHostname}:8085`,
  ...localIPs,
  ...localIPs.map((ip) => `${ip}:8085`),
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
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
};

export default nextConfig;
