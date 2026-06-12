import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@platform/ui'],
  output: 'standalone',
  // Trace files from monorepo root so workspace packages are included in the bundle
  outputFileTracingRoot: path.join(__dirname, '../../'),
  // Screens is served under /screens/ by Nginx — basePath ensures _next/static
  // assets are requested as /screens/_next/static/... so Nginx routes them correctly
  basePath: '/screens',
};

export default nextConfig;
