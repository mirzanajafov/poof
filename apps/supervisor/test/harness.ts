import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { createPrisma, type PrismaClient } from '@poof/db'
import sharp from 'sharp'
import { inject } from 'vitest'
import { AppModule, configureApp } from '../src/app.module.js'

export interface Running {
  app: INestApplication
  db: PrismaClient
  close(): Promise<void>
}

export async function makeData(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'poof-supervisor-'))
  await dataset(root, 'small', 40, [])
  await dataset(root, 'broken', 10, [2, 5, 7])
  await dataset(root, 'mostly-good', 40, [17])
  await noisy(root, 'noisy', 30)
  return root
}

async function dataset(root: string, name: string, count: number, corrupt: number[]): Promise<void> {
  const dir = join(root, 'datasets', name)
  await mkdir(dir, { recursive: true })
  const items = []
  for (let i = 0; i < count; i++) {
    const file = `${i}.jpg`
    const body = corrupt.includes(i)
      ? Buffer.from('not an image')
      : await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: (i * 13) % 255, g: 120, b: 80 } } })
          .jpeg()
          .toBuffer()
    await writeFile(join(dir, file), body)
    items.push({ file, width: 640, height: 480 })
  }
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({ items }))
}

async function noisy(root: string, name: string, count: number): Promise<void> {
  const dir = join(root, 'datasets', name)
  await mkdir(dir, { recursive: true })
  const items = []
  for (let i = 0; i < count; i++) {
    const file = `${i}.jpg`
    const image = sharp({ create: { width: 2000, height: 1500, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 120 + i, sigma: 40 } } })
    await writeFile(join(dir, file), await image.jpeg({ quality: 90 }).toBuffer())
    items.push({ file, width: 2000, height: 1500 })
  }
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({ items }))
}

export async function start(dataDir: string, env: Record<string, string> = {}): Promise<Running> {
  Object.assign(process.env, {
    DATABASE_URL: inject('databaseUrl'),
    REDIS_URL: process.env.POOF_TEST_REDIS_URL ?? 'redis://localhost:6387',
    DATA_DIR: dataDir,
    BUDGET: '2',
    CHECKPOINT_MS: '200',
    ...env,
  })
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register()] }).compile()
  const app = configureApp(moduleRef.createNestApplication({ logger: false }))
  await app.init()
  const db = createPrisma(inject('databaseUrl'))
  return {
    app,
    db,
    async close() {
      await app.close()
      await db.$disconnect()
    },
  }
}

export async function until<T>(probe: () => Promise<T | null | undefined | false>, timeoutMs = 60_000): Promise<T> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const value = await probe()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('timed out waiting')
}
