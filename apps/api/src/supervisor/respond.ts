import type { Response } from 'express'
import type { SupervisorReply } from './supervisor.client.js'

export function respondWith(res: Response, reply: SupervisorReply): unknown {
  res.status(reply.status)
  if (reply.retryAfter) res.setHeader('Retry-After', reply.retryAfter)
  return reply.body
}
