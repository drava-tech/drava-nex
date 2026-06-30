import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@platform/ui'],
  output: process.platform === 'win32' ? undefined : 'standalone', // ponytail: disable standalone on Windows to avoid EPERM symlink errors
  // Trace files from monorepo root so workspace packages are included in the bundle
  outputFileTracingRoot: path.join(__dirname, '../../'),
  experimental: {
    middlewareClientMaxBodySize: '100mb',
  },
};

export default nextConfig;
