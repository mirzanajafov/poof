import type { OnApplicationShutdown } from '@nestjs/common'
import { type OnGatewayConnection, type OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets'
import { liveEventsChannel, parseLiveEvent, type LiveEvent, type LiveSocketEvents } from '@poof/contracts'
import type { Server, Socket } from 'socket.io'
import { Cache } from '../infra/cache.js'

const BATCH_MS = 150
const SNAPSHOT_MS = 1000
const MAX_BUFFER = 1000

@WebSocketGateway()
export class LiveGateway implements OnGatewayInit, OnGatewayConnection, OnApplicationShutdown {
  @WebSocketServer()
  server: Server<Record<string, never>, LiveSocketEvents>

  private buffer: LiveEvent[] = []
  private dropped = 0
  private timers: NodeJS.Timeout[] = []

  constructor(private readonly cache: Cache) {}

  afterInit(): void {
    this.cache.subscribe(liveEventsChannel, (message) => {
      const event = parseLiveEvent(message)
      if (!event || this.buffer.length >= MAX_BUFFER) {
        this.dropped++
        return
      }
      this.buffer.push(event)
    })
    this.timers.push(setInterval(() => this.flush(), BATCH_MS))
    this.timers.push(setInterval(() => void this.broadcastSnapshot(), SNAPSHOT_MS))
  }

  async handleConnection(client: Socket<Record<string, never>, LiveSocketEvents>): Promise<void> {
    const snapshot = await this.cache.liveSnapshot().catch(() => null)
    if (snapshot) client.emit('snapshot', snapshot)
  }

  private flush(): void {
    if (this.buffer.length === 0 && this.dropped === 0) return
    this.server.emit('events', { events: this.buffer.splice(0), dropped: this.dropped })
    this.dropped = 0
  }

  private async broadcastSnapshot(): Promise<void> {
    if (this.server.engine.clientsCount === 0) return
    const snapshot = await this.cache.liveSnapshot().catch(() => null)
    if (snapshot) this.server.emit('snapshot', snapshot)
  }

  onApplicationShutdown(): void {
    for (const timer of this.timers) clearInterval(timer)
  }
}
