import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const adminUrl = process.env.POOF_TEST_ADMIN_URL ?? 'postgresql://poof:poof@localhost:5447/postgres'

export interface TestDatabase {
  url: string
  drop(): Promise<void>
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `poof_test_${process.pid}_${Date.now()}`
  const drop = () => run(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
  await run(`CREATE DATABASE ${name}`)
  const url = new URL(adminUrl)
  url.pathname = `/${name}`
  try {
    execSync('npx prisma migrate deploy', {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      env: { ...process.env, DATABASE_URL: url.toString() },
      stdio: 'pipe',
    })
  } catch (error) {
    await drop()
    throw error
  }
  return { url: url.toString(), drop }
}

async function run(sql: string): Promise<void> {
  const admin = new pg.Client({ connectionString: adminUrl })
  await admin.connect()
  try {
    await admin.query(sql)
  } finally {
    await admin.end()
  }
}
