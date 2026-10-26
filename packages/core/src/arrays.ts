export function valueAt<T>(values: ArrayLike<T>, index: number): T {
  const value = values[index]
  if (value === undefined) throw new RangeError(`no value at ${index} of ${values.length}`)
  return value
}
