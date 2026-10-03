'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { Dataset } from '@/lib/types'

type Outcome =
  | { kind: 'accepted'; id: string; items: number; predictedSeconds: number }
  | { kind: 'refused'; message: string; retryAfter: number | null }

const presets = [
  { value: 'webp-1600', label: 'WebP, 1600 px' },
  { value: 'thumb-320', label: 'Thumbnail, 320 px' },
]

export function PressTheButton({ datasets }: { datasets: Dataset[] }) {
  const [dataset, setDataset] = useState(datasets[0]?.name ?? 'synthetic')
  const [preset, setPreset] = useState(presets[0]!.value)
  const [count, setCount] = useState(60)
  const [deadline, setDeadline] = useState(60)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dataset, preset, count, deadlineSeconds: deadline }),
      })
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (res.status === 201) {
        setOutcome({ kind: 'accepted', id: String(body.id), items: Number(body.items), predictedSeconds: Number(body.predictedSeconds) })
      } else {
        const retry = res.headers.get('retry-after')
        setOutcome({
          kind: 'refused',
          message: String(body.reason ?? body.message ?? `the box said ${res.status}`),
          retryAfter: retry ? Number(retry) : null,
        })
      }
    } catch {
      setOutcome({ kind: 'refused', message: 'the box did not answer', retryAfter: null })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      <h2 className="text-base font-semibold">Press the button</h2>
      <p className="mt-1 text-sm text-muted">
        Send a batch of photos to resize. The box predicts the work from the image sizes and either takes it or tells you
        when to come back.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="text-muted">Photos</span>
          <select
            value={dataset}
            onChange={(e) => setDataset(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-raised px-2 py-1.5"
          >
            {datasets.map((d) => (
              <option key={d.name} value={d.name}>
                {d.name}, {d.items} photos, ~{Math.round(d.meanMp)} MP
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-muted">Output</span>
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-raised px-2 py-1.5"
          >
            {presets.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-muted">How many</span>
          <input
            type="range"
            min={10}
            max={500}
            step={10}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="mt-2 w-full accent-[var(--accent)]"
          />
          <span className="tabular text-xs text-muted">{count} images</span>
        </label>
        <label className="text-sm">
          <span className="text-muted">Deadline</span>
          <input
            type="range"
            min={5}
            max={300}
            step={5}
            value={deadline}
            onChange={(e) => setDeadline(Number(e.target.value))}
            className="mt-2 w-full accent-[var(--accent)]"
          />
          <span className="tabular text-xs text-muted">{deadline} seconds</span>
        </label>
      </div>
      <button
        type="submit"
        disabled={busy}
        className="mt-4 w-full rounded-lg bg-accent px-4 py-2.5 font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
      >
        {busy ? 'Asking the box…' : 'Poof'}
      </button>
      {outcome?.kind === 'accepted' && (
        <p className="mt-3 rounded-md bg-good-soft px-3 py-2 text-sm">
          Taken: {outcome.items} images, about {outcome.predictedSeconds} s of work.{' '}
          <Link href={`/tasks/${outcome.id}`} className="font-medium text-accent-ink underline">
            Watch it
          </Link>
        </p>
      )}
      {outcome?.kind === 'refused' && (
        <p className="mt-3 rounded-md bg-warn-soft px-3 py-2 text-sm">
          Not taken: {outcome.message}.{outcome.retryAfter ? ` Try again in ${outcome.retryAfter} s.` : ''}
        </p>
      )}
    </form>
  )
}
