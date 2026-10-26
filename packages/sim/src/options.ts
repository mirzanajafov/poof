export function count(option: string, text: string): number {
  const value = Number(text)
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${option} needs a whole number above zero, not ${text}`)
  return value
}

export function knownNames(spec: string, known: readonly string[], kind: string): string[] {
  const names = spec.split(',')
  const unknown = names.filter((name) => !known.includes(name))
  if (unknown.length > 0) throw new Error(`unknown ${kind} ${unknown.join(', ')}`)
  return names
}
