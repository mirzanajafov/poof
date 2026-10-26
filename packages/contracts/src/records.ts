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

type Check<T> = [T] extends [boolean]
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
          : [T] extends [object]
            ? 'object'
            : never

export type Checks<T> = { [F in keyof T]-?: Check<T[F]> }

type FieldCheck = 'boolean' | 'number' | 'string' | 'number or null' | 'string or null' | 'object' | readonly unknown[]

function passes(value: unknown, check: FieldCheck): boolean {
  if (typeof check !== 'string') return check.some((allowed) => allowed === value)
  if (check === 'number or null') return value === null || typeof value === 'number'
  if (check === 'string or null') return value === null || typeof value === 'string'
  if (check === 'object') return isRecord(value)
  return typeof value === check
}

function fieldProblem(value: unknown, checks: Readonly<Record<string, FieldCheck>>): string | null {
  if (!isRecord(value)) return 'is not an object'
  const failed = Object.entries(checks).find(([field, check]) => !passes(value[field], check))
  return failed ? `has no valid ${failed[0]}` : null
}

export function hasFields<T>(value: unknown, checks: Checks<T>): value is T {
  return fieldProblem(value, checks) === null
}

export function assertFields<T>(value: unknown, checks: Checks<T>, what: string): asserts value is T {
  const problem = fieldProblem(value, checks)
  if (problem !== null) throw new Error(`${what} ${problem}`)
}
