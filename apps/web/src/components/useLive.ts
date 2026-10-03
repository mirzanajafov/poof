'use client'

import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import type { LiveEvent, Snapshot } from '@/lib/types'

export interface Live {
  connected: boolean
  snapshot: Snapshot
  events: LiveEvent[]
  processes: number[]
  throughput: number
}

const KEEP_EVENTS = 60
const KEEP_POINTS = 120

export function useLive(): Live {
  const [connected, setConnected] = useState(false)
  const [snapshot, setSnapshot] = useState<Snapshot>({ live: null, exhibit: null })
  const [events, setEvents] = useState<LiveEvent[]>([])
  const [processes, setProcesses] = useState<number[]>([])
  const [throughput, setThroughput] = useState(0)
  const items = useRef<number[]>([])
  const since = useRef(0)
  const exhibitId = useRef<string | null>(null)

  useEffect(() => {
    since.current = Date.now()
    const socket = io(process.env.NEXT_PUBLIC_LIVE_URL ?? window.location.origin, { transports: ['websocket', 'polling'] })
    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))
    socket.on('snapshot', (next: Snapshot) => {
      setSnapshot(next)
      const id = next.exhibit?.id ?? null
      if (id !== exhibitId.current) {
        exhibitId.current = id
        setProcesses([])
      }
      if (next.exhibit) setProcesses((points) => [...points, next.exhibit!.processes].slice(-KEEP_POINTS))
      const now = Date.now()
      items.current = items.current.filter((t) => now - t < 10_000)
      setThroughput(items.current.length / Math.min(10, Math.max(1, (now - since.current) / 1000)))
    })
    socket.on('events', (batch: { events: LiveEvent[] }) => {
      const now = Date.now()
      for (const event of batch.events) if (event.kind === 'item' && event.ok) items.current.push(now)
      const kept = batch.events.filter((e) => e.kind !== 'item')
      if (kept.length > 0) setEvents((current) => [...kept.reverse(), ...current].slice(0, KEEP_EVENTS))
    })
    return () => {
      socket.close()
    }
  }, [])

  return { connected, snapshot, events, processes, throughput }
}
