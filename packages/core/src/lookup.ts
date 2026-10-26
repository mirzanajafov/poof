export function valueAt<T>(values: ArrayLike<T>, index: number): T {
  const value = values[index]
  if (value === undefined) throw new RangeError(`no value at ${index} of ${values.length}`)
  return value
}

export function valueFor<T>(values: ReadonlyMap<string, T>, key: string): T {
  const value = values.get(key)
  if (value === undefined) throw new RangeError(`no value for ${key}`)
  return value
}
