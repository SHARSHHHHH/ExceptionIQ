import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: false },
  poweredByHeader: false,
  // The repo has lockfiles at the root and in backend/; pin tracing to the backend package.
  outputFileTracingRoot: process.cwd(),
};
export default nextConfig;
