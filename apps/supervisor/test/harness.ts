import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import { hasFields, parseSubmitResult } from '@poof/contracts'
import { createPrisma, type PrismaClient, type Task } from '@poof/db'
import { enableValidationAndShutdownHooks, parseEnv } from '@poof/nest'
import { Redis } from 'ioredis'
import sharp from 'sharp'
import request from 'supertest'
import { inject, vi } from 'vitest'
import { AppModule } from '../src/app.module.js'
import { Env } from '../src/config/env.js'

const redisUrl = process.env.POOF_TEST_REDIS_URL ?? 'redis://localhost:6387/4'

export interface Running {
  app: NestExpressApplication
  db: PrismaClient
  redis: Redis
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
      : await sharp({
          create: { width: 640, height: 480, channels: 3, background: { r: (i * 13) % 255, g: 120, b: 80 } },
        })
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
    const image = sharp({
      create: {
        width: 2000,
        height: 1500,
        channels: 3,
        background: '#808080',
        noise: { type: 'gaussian', mean: 120 + i, sigma: 40 },
      },
    })
    await writeFile(join(dir, file), await image.jpeg({ quality: 90 }).toBuffer())
    items.push({ file, width: 2000, height: 1500 })
  }
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({ items }))
}

export const patience = { timeout: 60_000, interval: 100 }

export const http = (running: Running) => request(running.app.getHttpServer())

export async function start(dataDir: string, overrides: Partial<Record<keyof Env, string>> = {}): Promise<Running> {
  const env = parseEnv(Env, {
    DATABASE_URL: inject('databaseUrl'),
    REDIS_URL: redisUrl,
    DATA_DIR: dataDir,
    BUDGET: '2',
    CHECKPOINT_MS: '200',
    ...overrides,
  })
  const redis = new Redis(redisUrl)
  await redis.flushdb()
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Env)
    .useValue(env)
    .compile()
  const app = enableValidationAndShutdownHooks(
    moduleRef.createNestApplication<NestExpressApplication>({ logger: false }),
  )
  await app.init()
  const db = createPrisma(inject('databaseUrl'))
  return {
    app,
    db,
    redis,
    async close() {
      await app.close()
      await db.$disconnect()
      await redis.quit()
    },
  }
}

export async function waitForTask(running: Running, id: string, ready: (task: Task) => boolean) {
  return vi.waitUntil(async () => {
    const task = await running.db.task.findUnique({ where: { id } })
    return task && ready(task) ? task : null
  }, patience)
}

export async function waitForExhibitEnd(running: Running, id: string) {
  return vi.waitUntil(async () => {
    const exhibit = await running.db.exhibit.findUnique({ where: { id } })
    return exhibit && exhibit.status !== 'RUNNING' ? exhibit : null
  }, patience)
}

export function taskId(body: unknown): string {
  const submitted = parseSubmitResult(body)
  if (!submitted?.id) throw new Error(`the supervisor answered a submission without a task id: ${JSON.stringify(body)}`)
  return submitted.id
}

export function exhibitId(body: unknown): string {
  if (!hasFields<{ id: string }>(body, { id: 'string' })) {
    throw new Error(`the supervisor answered an exhibit start without an id: ${JSON.stringify(body)}`)
  }
  return body.id
}
