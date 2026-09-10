import type { NextConfig } from 'next';
const config: NextConfig = {
  transpilePackages: ['@jinzhang/core'],
  poweredByHeader: false,
  serverExternalPackages: ['ali-oss', 'sharp'],
};
export default config;
