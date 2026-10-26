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
  if (typeof body === 'object' && body !== null) {
    if ('reason' in body && typeof body.reason === 'string') return body.reason
    if ('message' in body && typeof body.message === 'string') return body.message
  }
  return `the box said ${answer.status}`
}
