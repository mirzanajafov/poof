import { isRecord } from './records.ts'
export const datasetNamePattern = /^[a-z0-9][a-z0-9-]{0,62}$/

export interface TaskManifestItem {
  file: string
}

export interface TaskManifest {
  items: TaskManifestItem[]
}

export interface ManifestItem extends TaskManifestItem {
  width: number
  height: number
}

export interface Manifest {
  source?: string
  items: ManifestItem[]
}

export interface DatasetSummary {
  name: string
  items: number
  meanMp: number
}

const fileNamePattern = /^(?!\.\.?$|manifest\.json$)[^/\\]+$/i

function isDimension(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0
}

function parseItems<T>(
  text: string,
  origin: string,
  toItem: (fields: Record<string, unknown>, file: string, at: string) => T,
): { source: unknown; items: T[] } {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`${origin} is not valid JSON`)
  }
  if (!isRecord(json) || !Array.isArray(json.items) || json.items.length === 0) {
    throw new Error(`${origin} lists no items`)
  }
  const items = json.items.map((item: unknown, index) => {
    const at = `${origin}: item ${index}`
    if (!isRecord(item)) throw new Error(`${at} is not an object`)
    const { file } = item
    if (typeof file !== 'string' || !fileNamePattern.test(file)) throw new Error(`${at} needs a plain file name`)
    return toItem(item, file, at)
  })
  return { source: json.source, items }
}

export function parseTaskManifest(text: string, origin: string): TaskManifest {
  return { items: parseItems(text, origin, (_, file) => ({ file })).items }
}

export function parseManifest(text: string, origin: string): Manifest {
  const { source, items } = parseItems(text, origin, ({ width, height }, file, at) => {
    if (!isDimension(width) || !isDimension(height)) throw new Error(`${at} needs a positive integer width and height`)
    return { file, width, height }
  })
  if (source !== undefined && typeof source !== 'string') throw new Error(`${origin} has a source that is not text`)
  return { source, items }
}
