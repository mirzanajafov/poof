export function count(option: string, text: string): number {
  const value = Number(text)
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${option} needs a whole number above zero, not ${text}`)
  return value
}

export function positive(option: string, text: string): number {
  const value = Number(text)
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`--${option} needs a finite number above zero, not ${text}`)
  return value
}

export function knownNames(spec: string, known: readonly string[], kind: string): string[] {
  const names = spec.split(',')
  const unknown = names.filter((name) => !known.includes(name))
  if (unknown.length > 0) throw new Error(`unknown ${kind} ${unknown.join(', ')}`)
  const repeated = names.filter((name, i) => names.indexOf(name) !== i)
  if (repeated.length > 0) throw new Error(`${kind} ${repeated.join(', ')} given more than once`)
  return names
}
