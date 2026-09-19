import { fileURLToPath } from 'node:url';

const sharedSourceEntry = fileURLToPath(
  new URL('../../packages/shared/src/index.ts', import.meta.url),
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  // No application feature uses next/image. Keep its public decoder endpoint
  // closed until an explicitly reviewed image-processing feature needs it.
  images: { unoptimized: true },
  // The shared workspace package is authored outside this Next.js app. Let
  // Next compile it as application code so React Refresh does not treat its
  // CommonJS build output as an already-processed client module.
  transpilePackages: ['@ai-video-qc/shared'],
  webpack(config) {
    // In development React Refresh cannot safely inject ESM hot-reload code
    // into the package's CommonJS dist entry. The web app consumes the ESM
    // TypeScript source while the Nest API keeps using the CommonJS build.
    config.resolve.alias['@ai-video-qc/shared$'] = sharedSourceEntry;
    return config;
  },
};

export default nextConfig;
