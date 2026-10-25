export const datasetNamePattern = /^[a-z0-9][a-z0-9-]{0,62}$/

export interface ManifestItem {
  file: string
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

const fileNamePattern = /^(?!\.\.?$)[^/\\]+$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDimension(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0
}

export function parseManifest(text: string, origin: string): Manifest {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`${origin} is not valid JSON`)
  }
  if (!isRecord(json) || !Array.isArray(json.items) || json.items.length === 0) {
    throw new Error(`${origin} lists no items`)
  }
  const { source } = json
  if (source !== undefined && typeof source !== 'string') throw new Error(`${origin} has a source that is not text`)
  const items = json.items.map((item: unknown, index): ManifestItem => {
    if (!isRecord(item)) throw new Error(`${origin}: item ${index} is not an object`)
    const { file, width, height } = item
    if (typeof file !== 'string' || !fileNamePattern.test(file)) {
      throw new Error(`${origin}: item ${index} needs a plain file name`)
    }
    if (!isDimension(width) || !isDimension(height)) {
      throw new Error(`${origin}: item ${index} needs a positive integer width and height`)
    }
    return { file, width, height }
  })
  return { source, items }
}
