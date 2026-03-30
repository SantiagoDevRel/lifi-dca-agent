/** @type {import('next').NextConfig} */
const nextConfig = {
  // Prevent webpack from bundling these CJS packages — let Node require() them directly
  serverExternalPackages: ['viem', '@anthropic-ai/sdk', 'node-cron', 'dotenv'],
}

module.exports = nextConfig
