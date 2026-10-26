import { Breakers, type LeaseState, type PresetName } from '@poof/core'
import { startTracing } from '@poof/tracing'
import type { ExitReport, ItemDead, ItemDone } from '@poof/worker'
import { describe, expect, it, vi } from 'vitest'
import { TaskBook, type BookRules } from './task-book.js'
import { Task, type TaskLease } from './task.js'

const tracer = startTracing('test').tracer

function newTask(items = 10): Task {
  return new Task({
    id: 'task',
    preset: 'webp-1600',
    items,
    submittedAt: Date.now(),
    deadline: Date.now() + 60_000,
    dir: 'tasks/task',
    predicted: new Float64Array(items).fill(100),
    span: tracer.startSpan('task'),
  })
}

function addLease(task: Task, lo: number, hi: number, state: LeaseState = 'running'): TaskLease {
  const lease: TaskLease = { id: `lease-${lo}`, lo, hi, cursor: lo, state, span: null }
  task.leases.push(lease)
  return lease
}

function setup(rules: Partial<BookRules> = {}) {
  const store = {
    reject: vi.fn(() => Promise.resolve()),
    accept: vi.fn(() => Promise.resolve()),
    started: vi.fn(),
    decided: vi.fn(),
    leaseReleased: vi.fn(),
    deadLettered: vi.fn(),
    breakerChanged: vi.fn(),
    finished: vi.fn(),
    failed: vi.fn(),
  }
  const events = { publish: vi.fn() }
  const stop = vi.fn()
  const book = new TaskBook(
    store,
    events,
    tracer,
    new Breakers<PresetName>(),
    { maxAttempts: 3, deadLetterShare: 0.5, deadLetter: true, ...rules },
    stop,
  )
  return { book, store, events, stop }
}

const done = (lease: TaskLease, item: number): ItemDone => ({
  type: 'item',
  lease: lease.id,
  item,
  ok: true,
  wallMs: 100,
  cpuMs: 100,
  stepCpuMs: 110,
  outBytes: 1000,
})

const dead = (lease: TaskLease, item: number): ItemDead => ({
  type: 'item',
  lease: lease.id,
  item,
  ok: false,
  attempts: 3,
  error: 'corrupt input',
})

const crash = (lease: TaskLease, item: number): ExitReport => ({
  reason: 'crash',
  code: 1,
  signal: null,
  inflight: { lease: lease.id, item, since: 0 },
  stderr: '',
})

describe('TaskBook', () => {
  it('writes a finished task together with the leases that have not reported done yet', () => {
    const { book, store, events } = setup()
    const task = newTask()
    const first = addLease(task, 0, 5, 'done')
    const second = addLease(task, 5, 10)
    for (let item = 0; item < 10; item++) {
      const lease = item < 5 ? first : second
      book.succeeded(task, lease, done(lease, item))
    }
    expect(task.status).toBe('DONE')
    expect(store.finished).toHaveBeenCalledTimes(1)
    expect(store.finished).toHaveBeenCalledWith(task, [second], expect.any(Date))
    expect(events.publish).toHaveBeenCalledWith(expect.objectContaining({ kind: 'task.done', met: true, dead: 0 }))
  })

  it('retries the item a crashed worker held and dead-letters it on the last attempt', () => {
    const { book, store } = setup()
    const task = newTask()
    const lease = addLease(task, 0, 10)
    lease.cursor = 3
    for (let attempt = 1; attempt <= 3; attempt++) {
      lease.state = 'running'
      book.released(task, lease, crash(lease, 3))
      expect(store.decided).toHaveBeenLastCalledWith('task', 'worker-exit', {
        reason: 'crash',
        item: 3,
        attempts: attempt,
      })
    }
    expect(store.deadLettered).toHaveBeenCalledTimes(1)
    expect(store.deadLettered).toHaveBeenCalledWith('task', 3, 3, 'worker crash')
    expect(lease).toMatchObject({ cursor: 4, state: 'pending' })
    expect(task.dead).toBe(1)
  })

  it('keeps retrying a crashed item when the policy does not dead-letter', () => {
    const { book, store } = setup({ deadLetter: false })
    const task = newTask()
    const lease = addLease(task, 0, 10)
    for (let attempt = 1; attempt <= 5; attempt++) {
      lease.state = 'running'
      book.released(task, lease, crash(lease, 0))
    }
    expect(store.deadLettered).not.toHaveBeenCalled()
    expect(lease).toMatchObject({ cursor: 0, state: 'pending' })
  })

  it('fails a task past its dead letter share, closes its waiting leases and stops its running ones', () => {
    const { book, store, events, stop } = setup({ deadLetterShare: 0.1 })
    const task = newTask()
    const running = addLease(task, 0, 5)
    const waiting = addLease(task, 5, 10, 'pending')
    running.cursor = 2
    book.failedItem(task, running, dead(running, 0))
    expect(task.open).toBe(true)
    book.failedItem(task, running, dead(running, 1))
    expect(task.status).toBe('FAILED')
    expect(store.failed).toHaveBeenCalledWith(task, 'fail', 'too many dead letters', expect.any(Date))
    expect(stop).toHaveBeenCalledWith(running)
    expect(waiting.state).toBe('done')
    expect(events.publish).toHaveBeenCalledWith(expect.objectContaining({ kind: 'task.failed' }))
  })

  it('puts a lease back as pending for an open task and as done for a closed one', () => {
    const { book, store } = setup()
    const open = newTask()
    const waiting = addLease(open, 0, 10)
    waiting.cursor = 4
    book.putBack(open, waiting)
    expect(waiting.state).toBe('pending')
    expect(store.leaseReleased).toHaveBeenLastCalledWith(waiting.id, 'pending', 4)
    const failed = newTask()
    const stranded = addLease(failed, 0, 10)
    book.fail(failed, 'cancelled by the test', 'cancel')
    book.putBack(failed, stranded)
    expect(stranded.state).toBe('done')
    expect(store.leaseReleased).toHaveBeenLastCalledWith(stranded.id, 'done', 0)
  })

  it('tells the store and the live view once when a preset breaker opens', () => {
    const { book, store, events } = setup({ deadLetterShare: 1 })
    const task = newTask(20)
    const lease = addLease(task, 0, 20)
    for (let item = 0; item < 12; item++) book.failedItem(task, lease, dead(lease, item))
    expect(store.breakerChanged).toHaveBeenCalledTimes(1)
    expect(store.breakerChanged).toHaveBeenCalledWith('webp-1600', 'open')
    expect(events.publish).toHaveBeenCalledWith({ kind: 'breaker', preset: 'webp-1600', state: 'open' })
  })
})
