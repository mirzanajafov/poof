import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface DatasetItem {
  file: string
  width: number
  height: number
  bytes: number
  mp: number
}

export interface Dataset {
  dir: string
  source: string
  items: DatasetItem[]
}

export async function loadDataset(dir: string): Promise<Dataset> {
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as Omit<Dataset, 'dir'>
  return { dir, ...manifest }
}

export function itemPath(dataset: Dataset, item: DatasetItem): string {
  return join(dataset.dir, item.file)
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function shuffled<T>(items: T[], seed: number): T[] {
  const rand = mulberry32(seed)
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}
