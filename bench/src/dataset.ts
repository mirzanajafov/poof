import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseManifest, type ManifestItem } from '@poof/contracts'
import { manifestPath } from '@poof/contracts/layout'
import { Rng, valueAt } from '@poof/core'

export interface DatasetItem extends ManifestItem {
  mp: number
}

export interface Dataset {
  dir: string
  source: string
  items: DatasetItem[]
}

export async function loadDataset(dir: string): Promise<Dataset> {
  const path = manifestPath(dir)
  const { source, items } = parseManifest(await readFile(path, 'utf8'), path)
  if (!source) throw new Error(`${path} does not say where its images come from`)
  return { dir, source, items: items.map((item) => ({ ...item, mp: (item.width * item.height) / 1e6 })) }
}

export function itemPath(dataset: Dataset, item: DatasetItem): string {
  return join(dataset.dir, item.file)
}

export function shuffled<T>(items: T[], seed: number): T[] {
  const rng = new Rng(seed)
  const shuffledItems = [...items]
  for (let i = shuffledItems.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1))
    ;[shuffledItems[i], shuffledItems[j]] = [valueAt(shuffledItems, j), valueAt(shuffledItems, i)]
  }
  return shuffledItems
}
