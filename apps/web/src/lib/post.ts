import { isRecord } from '@poof/contracts'

export interface Answer {
  status: number
  body: unknown
  retryAfter: number | null
}

export async function post(path: string, body: unknown): Promise<Answer> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const retryAfter = res.headers.get('retry-after')
  return {
    status: res.status,
    body: await res.json().catch(() => null),
    retryAfter: retryAfter ? Number(retryAfter) : null,
  }
}

export function refusal(answer: Answer): string {
  const { body } = answer
  if (isRecord(body)) {
    if (typeof body.reason === 'string') return body.reason
    if (typeof body.message === 'string') return body.message
    if (Array.isArray(body.message)) return body.message.join(', ')
  }
  return `the box said ${answer.status}`
}
