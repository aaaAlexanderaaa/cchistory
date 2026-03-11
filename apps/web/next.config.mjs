const allowedDevOrigins = [
  process.env.CCHISTORY_PUBLIC_WEB_ORIGIN,
  ...(process.env.CCHISTORY_ALLOWED_DEV_ORIGINS?.split(',') ?? []),
]
  .map((value) => value?.trim())
  .filter(Boolean)
  .map((value) => value.replace(/^https?:\/\//, '').replace(/\/$/, ''))

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins,
  // React Compiler disabled - not needed for this prototype
  async rewrites() {
    const internalApiOrigin = process.env.CCHISTORY_INTERNAL_API_ORIGIN || 'http://127.0.0.1:4040';

    return [
      {
        source: '/api/cchistory/:path*',
        destination: `${internalApiOrigin}/:path*`,
      },
    ];
  },
};

export default nextConfig;
