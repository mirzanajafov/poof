import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

const api = process.env.API_URL ?? 'http://localhost:3111'

const config: NextConfig = {
  poweredByHeader: false,
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }]
  },
}

export default config
