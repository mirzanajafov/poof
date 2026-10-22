import { datasetNamePattern } from './dataset-name.js'

export function parseDatasetSource(spec: string): { name: string; dir: string } | undefined {
  const separator = spec.indexOf('=')
  if (separator === -1) return undefined
  const name = spec.slice(0, separator)
  const dir = spec.slice(separator + 1)
  return datasetNamePattern.test(name) && dir ? { name, dir } : undefined
}
