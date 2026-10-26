import 'server-only'

const base = process.env.API_URL ?? 'http://localhost:3111'

export async function api<T>(path: string): Promise<T | null> {
  const res = await fetch(`${base}/api${path}`, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`the API answered ${res.status} for ${path}`)
  return (await res.json()) as T
}
