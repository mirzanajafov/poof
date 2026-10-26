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

export type Check<T> = [T] extends [boolean]
  ? 'boolean'
  : [T] extends [number]
    ? 'number'
    : [T] extends [string]
      ? string extends T
        ? 'string'
        : readonly T[]
      : [T] extends [number | null]
        ? 'number or null'
        : [T] extends [string | null]
          ? 'string or null'
          : 'object'

export type Checks<T> = { [F in keyof T]-?: Check<T[F]> }

type AnyCheck = 'boolean' | 'number' | 'string' | 'number or null' | 'string or null' | 'object' | readonly unknown[]

function passes(value: unknown, check: AnyCheck): boolean {
  if (typeof check !== 'string') return check.some((allowed) => allowed === value)
  if (check === 'number or null') return value === null || typeof value === 'number'
  if (check === 'string or null') return value === null || typeof value === 'string'
  if (check === 'object') return typeof value === 'object' && value !== null
  return typeof value === check
}

export function hasFields<T>(value: unknown, checks: Checks<T>): value is T {
  const table: Readonly<Record<string, AnyCheck>> = checks
  return isRecord(value) && Object.entries(table).every(([field, check]) => passes(value[field], check))
}
