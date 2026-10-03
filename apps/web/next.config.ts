import type { NextConfig } from 'next'

const api = process.env.API_URL ?? 'http://localhost:3111'

const config: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  output: 'standalone',
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }]
  },
}

export default config
