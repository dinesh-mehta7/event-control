/** @type {import('next').NextConfig} */
const nextConfig = {
  // The existing dashboard is intentionally client-rendered as one SPA.
  // Next provides the framework/build pipeline while hash-based app routes remain intact.
  // Keep production artifacts separate from `next dev`'s `.next` files.
  distDir: process.env.NEXT_PREVIEW === '1' ? '.next-preview' : process.env.NODE_ENV === 'production' ? '.next-production' : '.next',
};

module.exports = nextConfig;
