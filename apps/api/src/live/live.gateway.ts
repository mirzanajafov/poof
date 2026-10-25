import type { OnApplicationShutdown } from '@nestjs/common'
import { type OnGatewayConnection, type OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets'
import { liveEventsChannel, type LiveEvent, type LiveSocketEvents } from '@poof/contracts'
import { Redis } from 'ioredis'
import type { Server, Socket } from 'socket.io'
import { Cache } from '../infra/infra.module.js'

const BATCH_MS = 150
const SNAPSHOT_MS = 1000
const MAX_BUFFER = 1000

@WebSocketGateway()
export class LiveGateway implements OnGatewayInit, OnGatewayConnection, OnApplicationShutdown {
  @WebSocketServer()
  server: Server<Record<string, never>, LiveSocketEvents>

  private subscriber: Redis | null = null
  private buffer: LiveEvent[] = []
  private dropped = 0
  private timers: NodeJS.Timeout[] = []

  constructor(private readonly cache: Cache) {}

  afterInit(): void {
    this.subscriber = new Redis(this.cache.url, { maxRetriesPerRequest: null })
    this.subscriber.on('error', () => undefined)
    void this.subscriber.subscribe(liveEventsChannel).catch(() => undefined)
    this.subscriber.on('message', (_channel: string, message: string) => {
      if (this.buffer.length >= MAX_BUFFER) {
        this.dropped++
        return
      }
      this.buffer.push(JSON.parse(message) as LiveEvent)
    })
    this.timers.push(setInterval(() => this.flush(), BATCH_MS))
    this.timers.push(setInterval(() => void this.broadcastSnapshot(), SNAPSHOT_MS))
  }

  async handleConnection(client: Socket<Record<string, never>, LiveSocketEvents>): Promise<void> {
    client.emit('snapshot', await this.cache.liveSnapshot())
  }

  private flush(): void {
    if (this.buffer.length === 0 && this.dropped === 0) return
    this.server.emit('events', { events: this.buffer.splice(0), dropped: this.dropped })
    this.dropped = 0
  }

  private async broadcastSnapshot(): Promise<void> {
    if (this.server.engine.clientsCount === 0) return
    this.server.emit('snapshot', await this.cache.liveSnapshot())
  }

  async onApplicationShutdown(): Promise<void> {
    for (const timer of this.timers) clearInterval(timer)
    await this.subscriber?.quit().catch(() => undefined)
  }
}
