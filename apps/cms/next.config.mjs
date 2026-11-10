import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_INTERNAL = process.env.INTERNAL_API_URL ?? 'http://localhost:4000';

/**
 * Where uploaded files are fetched from when no page matches /media/... —
 * normally this machine's API. A dev checkout shares the office database but
 * not its files (they live on the deployment host), so every thumbnail there
 * 404s; set DEV_MEDIA_ORIGIN=http://<that host> in .env to load them from it.
 */
const MEDIA_ORIGIN = process.env.DEV_MEDIA_ORIGIN?.replace(/\/+$/, '') || API_INTERNAL;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // nginx does the gzip now (infra/nginx/default.conf). This defaults to TRUE,
  // which had Next compressing every response inside the single Node process
  // and nginx then handling an already-encoded body — paying for compression
  // twice on the CPU that also renders every page. Let the proxy own it.
  compress: false,
  transpilePackages: ['@platform/ui', '@platform/vision-browser'],
  output: process.platform === 'win32' ? undefined : 'standalone', // ponytail: disable standalone on Windows to avoid EPERM symlink errors
  // Trace files from monorepo root so workspace packages are included in the bundle
  outputFileTracingRoot: path.join(__dirname, '../../'),
  experimental: {
    // Barrel packages: without this, importing one helper from @platform/types
    // or one icon from lucide-react pulls the whole module graph into the
    // route bundle. Measured: one helper import cost /screens +75 kB before
    // this plus "sideEffects": false on the workspace packages.
    optimizePackageImports: ['@platform/ui', '@platform/types', 'lucide-react'],
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
      // Drava World (public/drava-world) is a multi-page app with folder
      // addresses: Next serves public/ files by exact name only, so point its
      // folders at their index.html, and its zone addresses (/zone/<id>, which
      // the app pushes as you move between zones) at the main page, so a
      // reload lands back in the same zone.
      afterFiles: [
        { source: '/drava-world', destination: '/drava-world/index.html' },
        { source: '/drava-world/zone/:id', destination: '/drava-world/index.html' },
        { source: '/drava-world/:page(cms|push|assembly)', destination: '/drava-world/:page/index.html' },
      ],
      // fallback (not beforeFiles/afterFiles): app routes under /media/ — like
      // the dynamic /media/live/[deviceId] — must resolve first. This only
      // proxies to the API's file server for paths with no matching page,
      // i.e. actual uploaded media files.
      fallback: [
        { source: '/media/:path*', destination: `${MEDIA_ORIGIN}/media/:path*` },
      ],
    };
  },
};

export default nextConfig;
