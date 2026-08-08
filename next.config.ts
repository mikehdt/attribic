import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Turn off to stop double-rendering in dev mode (eg. console logging twice)
  reactStrictMode: true,
  devIndicators: false,

  // Allow larger uploads for thumbnail creation
  experimental: {
    serverActions: {
      bodySizeLimit: '3mb',
    },
  },

  // Allow images from our API route
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'localhost',
      },
    ],
    minimumCacheTTL: 300, // Minimum cache time, in seconds
    unoptimized: true, // Disable Next.js image optimization for local files
    // writeToCacheDir: false,
  },

  // Silence info logs; keeps console.error and console.warn
  compiler: {
    removeConsole: {
      exclude: ['error', 'warn'],
    },
  },

  logging: {
    incomingRequests: {
      // Ignore stats calls which fill up the terminal
      ignore: [/^\/api\/training\/sidecar\/stats/],
    },
  },
};

export default nextConfig;
