import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import type { TestProject } from 'vitest/node'

const adminUrl = process.env.POOF_TEST_ADMIN_URL ?? 'postgresql://poof:poof@localhost:5447/postgres'

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string
  }
}

export default async function setup(project: TestProject) {
  const name = `poof_test_${Date.now()}`
  const admin = new pg.Client({ connectionString: adminUrl })
  await admin.connect()
  await admin.query(`CREATE DATABASE ${name}`)
  await admin.end()
  const url = new URL(adminUrl)
  url.pathname = `/${name}`
  execSync('npx prisma migrate deploy', {
    cwd: fileURLToPath(new URL('../../../packages/db/', import.meta.url)),
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: 'ignore',
  })
  project.provide('databaseUrl', url.toString())
  return async () => {
    const cleanup = new pg.Client({ connectionString: adminUrl })
    await cleanup.connect()
    await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
    await cleanup.end()
  }
}
