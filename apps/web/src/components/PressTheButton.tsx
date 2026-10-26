'use client'

import type { DatasetSummary } from '@poof/contracts'
import type { PresetName } from '@poof/core'
import Link from 'next/link'
import { useState } from 'react'
import { post, refusal } from '@/lib/post'

type Outcome =
  | { kind: 'accepted'; id: string; items: number; predictedSeconds: number }
  | { kind: 'refused'; message: string; retryAfter: number | null }

const presets: Partial<Record<PresetName, string>> = {
  'webp-1600': 'WebP, 1600 px',
  'thumb-320': 'Thumbnail, 320 px',
}

export function PressTheButton({ datasets }: { datasets: DatasetSummary[] }) {
  const [dataset, setDataset] = useState(datasets[0]?.name ?? 'synthetic')
  const [preset, setPreset] = useState('webp-1600')
  const [count, setCount] = useState(60)
  const [deadline, setDeadline] = useState(60)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  async function submit() {
    setBusy(true)
    try {
      const answer = await post('/api/tasks', { dataset, preset, count, deadlineSeconds: deadline })
      const accepted = answer.status === 201 ? acceptedTask(answer.body) : null
      setOutcome(
        accepted
          ? { kind: 'accepted', ...accepted }
          : { kind: 'refused', message: refusal(answer), retryAfter: answer.retryAfter },
      )
    } catch {
      setOutcome({ kind: 'refused', message: 'the box did not answer', retryAfter: null })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      className="rounded-xl border border-line bg-surface p-4 sm:p-5"
    >
      <h2 className="text-base font-semibold">Press the button</h2>
      <p className="mt-1 text-sm text-muted">
        Send a batch of photos to resize. The box predicts the work from the image sizes and either takes it or tells
        you when to come back.
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
                {d.name} ({d.items})
              </option>
            ))}
          </select>
          <span className="tabular text-xs text-muted">
            about {Math.round(datasets.find((d) => d.name === dataset)?.meanMp ?? 0)} MP per photo
          </span>
        </label>
        <label className="text-sm">
          <span className="text-muted">Output</span>
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-raised px-2 py-1.5"
          >
            {Object.entries(presets).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
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

function acceptedTask(body: unknown): { id: string; items: number; predictedSeconds: number } | null {
  if (typeof body !== 'object' || body === null || !('id' in body) || !('items' in body)) return null
  if (!('predictedSeconds' in body) || typeof body.id !== 'string') return null
  if (typeof body.items !== 'number' || typeof body.predictedSeconds !== 'number') return null
  return { id: body.id, items: body.items, predictedSeconds: body.predictedSeconds }
}
