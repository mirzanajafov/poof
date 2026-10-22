import type { INestApplicationContext } from '@nestjs/common'
import { IoAdapter } from '@nestjs/platform-socket.io'
import type { Server, ServerOptions } from 'socket.io'

export class LiveAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly origin: string,
  ) {
    super(app)
  }

  override createIOServer(port: number, options: ServerOptions): Server {
    return super.createIOServer(port, { ...options, cors: { origin: this.origin } })
  }
}
