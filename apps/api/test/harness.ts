import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Test } from '@nestjs/testing'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { createPrisma, type PrismaClient } from '@poof/db'
import { Redis } from 'ioredis'
import { inject } from 'vitest'
import { AppModule, configureApp } from '../src/app.module.js'

export const adminToken = 'test-admin-token-0123456789abcdef'
export const redisUrl = process.env.POOF_TEST_REDIS_URL ?? 'redis://localhost:6387/5'

export interface Call {
  method: string
  path: string
  body: unknown
}

export interface Reply {
  status: number
  body?: unknown
  headers?: Record<string, string>
}

export class StubSupervisor {
  readonly calls: Call[] = []
  reply: (call: Call) => Reply = () => ({ status: 201, body: { accepted: true, id: 'x' } })
  private server: Server | null = null
  url = ''

  async start(): Promise<void> {
    this.server = createServer(async (req, res) => {
      const body = await read(req)
      const call = { method: req.method ?? 'GET', path: req.url ?? '/', body: body ? JSON.parse(body) : undefined }
      this.calls.push(call)
      const reply = this.reply(call)
      res.writeHead(reply.status, { 'content-type': 'application/json', ...reply.headers })
      res.end(reply.body === undefined ? '' : JSON.stringify(reply.body))
    })
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve))
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()))
  }
}

function read(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk: Buffer) => (data += chunk.toString()))
    req.on('end', () => resolve(data))
  })
}

export interface Running {
  app: NestExpressApplication
  db: PrismaClient
  redis: Redis
  dataDir: string
  url: string
  close(): Promise<void>
}

export async function start(supervisorUrl: string, env: Record<string, string> = {}): Promise<Running> {
  const dataDir = await mkdtemp(join(tmpdir(), 'poof-api-'))
  Object.assign(process.env, {
    DATABASE_URL: inject('databaseUrl'),
    REDIS_URL: redisUrl,
    SUPERVISOR_URL: supervisorUrl,
    DATA_DIR: dataDir,
    ADMIN_TOKEN: adminToken,
    TRUST_PROXY: 'loopback',
    WEB_ORIGIN: 'http://localhost:3112',
    TASKS_PER_MINUTE: '10',
    EXHIBITS_PER_HOUR: '3',
    EXHIBIT_COOLDOWN_SECONDS: '120',
    PUBLIC_EXHIBIT_SECONDS: '60',
    ...env,
  })
  const redis = new Redis(redisUrl)
  await redis.flushdb()
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register()] }).compile()
  const app = configureApp(moduleRef.createNestApplication<NestExpressApplication>({ logger: false }))
  await app.listen(0, '127.0.0.1')
  const url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`
  const db = createPrisma(inject('databaseUrl'))
  return {
    app,
    db,
    redis,
    dataDir,
    url,
    async close() {
      await app.close()
      await db.$disconnect()
      await redis.quit()
    },
  }
}
