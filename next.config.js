/** @type {import('next').NextConfig} */
const nextConfig = {
  // The existing dashboard is intentionally client-rendered as one SPA.
  // Next provides the framework/build pipeline while hash-based app routes remain intact.
};

module.exports = nextConfig;
