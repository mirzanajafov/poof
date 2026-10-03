import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    include: ['test/**/*.e2e-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
})
