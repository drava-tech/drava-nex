import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// In Docker/production the screens app is served under /screens by nginx, so it
// needs a matching basePath (its routes + _next assets live under /screens). Set
// via the Dockerfile; left unset for local `pnpm dev`, where the app runs at the
// root on :3001. Must be NEXT_PUBLIC_* so Turbo's strict env mode passes it through
// to `next build` (custom vars are otherwise pruned).
const basePath = process.env.NEXT_PUBLIC_SCREENS_BASE_PATH || undefined;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@platform/ui'],
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),
  ...(basePath ? { basePath } : {}),
  async rewrites() {
    return [
      {
        source: '/media/:path*',
        destination: 'http://localhost:3000/media/:path*',
      },
    ];
  },
};

export default nextConfig;
