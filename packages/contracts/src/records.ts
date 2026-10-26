export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseJson(text: string, origin: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${origin} is not valid JSON`)
  }
}
