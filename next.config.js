/** @type {import('next').NextConfig} */
const nextConfig = {
  // The existing dashboard is intentionally client-rendered as one SPA.
  // Next provides the framework/build pipeline while hash-based app routes remain intact.
  // Vercel expects the standard `.next` output directory. Keep preview builds
  // isolated locally, but use `.next` for every other build environment.
  distDir: process.env.NEXT_PREVIEW === '1' ? '.next-preview' : '.next',
};

module.exports = nextConfig;
