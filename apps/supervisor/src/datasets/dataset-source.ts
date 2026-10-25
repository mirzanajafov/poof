import { datasetNamePattern } from '@poof/contracts'

export interface DatasetSource {
  name: string
  dir: string
}

export function parseDatasetSource(spec: string): DatasetSource | undefined {
  const separator = spec.indexOf('=')
  if (separator === -1) return undefined
  const name = spec.slice(0, separator)
  const dir = spec.slice(separator + 1)
  return datasetNamePattern.test(name) && dir ? { name, dir } : undefined
}
