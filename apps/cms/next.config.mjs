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
    return {
      // Next.js has no API routes — proxy everything to the single Hono backend.
      beforeFiles: [
        { source: '/api/:path*', destination: `${API_INTERNAL}/api/:path*` },
        { source: '/health',     destination: `${API_INTERNAL}/health` },
        { source: '/ws',         destination: `${API_INTERNAL}/ws` },
        { source: '/ws/:path*',  destination: `${API_INTERNAL}/ws/:path*` },
      ],
      // fallback (not beforeFiles/afterFiles): app routes under /media/ — like
      // the dynamic /media/live/[deviceId] — must resolve first. This only
      // proxies to the API's file server for paths with no matching page,
      // i.e. actual uploaded media files.
      fallback: [
        { source: '/media/:path*', destination: `${API_INTERNAL}/media/:path*` },
      ],
    };
  },
};

export default nextConfig;
