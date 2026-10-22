const datasetNamePattern = /^[a-z0-9][a-z0-9-]{0,62}$/

export function isDatasetName(name: string): boolean {
  return datasetNamePattern.test(name)
}

export function parseDatasetSource(spec: string): { name: string; dir: string } | undefined {
  const separator = spec.indexOf('=')
  if (separator === -1) return undefined
  const name = spec.slice(0, separator)
  const dir = spec.slice(separator + 1)
  return isDatasetName(name) && dir ? { name, dir } : undefined
}
