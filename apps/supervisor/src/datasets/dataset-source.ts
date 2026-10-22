const datasetName = /^[a-z0-9][a-z0-9-]{0,62}$/

export interface DatasetSource {
  name: string
  dir: string
}

export function isDatasetName(name: string): boolean {
  return datasetName.test(name)
}

export function parseDatasetSource(spec: string): DatasetSource | undefined {
  const separator = spec.indexOf('=')
  if (separator === -1) return undefined
  const name = spec.slice(0, separator)
  const dir = spec.slice(separator + 1)
  return isDatasetName(name) && dir ? { name, dir } : undefined
}
