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

const fileNamePattern = /^(?!\.\.?$|manifest\.json$)[^/\\]+$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDimension(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0
}

function parseItems(text: string, origin: string) {
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
    if (!isRecord(item)) throw new Error(`${origin}: item ${index} is not an object`)
    const { file } = item
    if (typeof file !== 'string' || !fileNamePattern.test(file)) {
      throw new Error(`${origin}: item ${index} needs a plain file name`)
    }
    return { file, fields: item }
  })
  return { source: json.source, items }
}

export function parseTaskManifest(text: string, origin: string): TaskManifest {
  return { items: parseItems(text, origin).items.map(({ file }) => ({ file })) }
}

export function parseManifest(text: string, origin: string): Manifest {
  const { source, items } = parseItems(text, origin)
  if (source !== undefined && typeof source !== 'string') throw new Error(`${origin} has a source that is not text`)
  return {
    source,
    items: items.map(({ file, fields: { width, height } }, index) => {
      if (!isDimension(width) || !isDimension(height)) {
        throw new Error(`${origin}: item ${index} needs a positive integer width and height`)
      }
      return { file, width, height }
    }),
  }
}
