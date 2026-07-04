import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_INTERNAL = process.env.INTERNAL_API_URL ?? 'http://localhost:4000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@platform/ui', '@platform/vision-browser'],
  output: process.platform === 'win32' ? undefined : 'standalone', // ponytail: disable standalone on Windows to avoid EPERM symlink errors
  // Trace files from monorepo root so workspace packages are included in the bundle
  outputFileTracingRoot: path.join(__dirname, '../../'),
  experimental: {
    middlewareClientMaxBodySize: '100mb',
  },
  async rewrites() {
    return [
      // Next.js has no API routes — proxy everything to the single Hono backend.
      { source: '/api/:path*', destination: `${API_INTERNAL}/api/:path*` },
      { source: '/ws/:path*',  destination: `${API_INTERNAL}/ws/:path*` },
    ];
  },
};

export default nextConfig;
