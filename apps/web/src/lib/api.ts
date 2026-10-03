import 'server-only'

const base = process.env.API_URL ?? 'http://localhost:3111'

export async function api<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${base}/api${path}`, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}
