import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseManifest } from '@poof/contracts'
import type { DatasetSource } from './dataset-source.js'
import { replaceWithLinkOrCopy } from './link-or-copy.js'

async function check({ name, dir }: DatasetSource) {
  const path = join(dir, 'manifest.json')
  const manifest = parseManifest(await readFile(path, 'utf8'), path)
  await Promise.all(manifest.items.map((item) => access(join(dir, item.file))))
  return { name, dir, manifest }
}

export async function prepareDatasets(
  sources: readonly DatasetSource[],
  dataDir: string,
): Promise<Array<{ name: string; items: number }>> {
  const checked = await Promise.all(sources.map(check))
  const prepared: Array<{ name: string; items: number }> = []
  for (const { name, dir, manifest } of checked) {
    const target = join(dataDir, 'datasets', name)
    await mkdir(target, { recursive: true })
    for (const item of manifest.items) await replaceWithLinkOrCopy(join(dir, item.file), join(target, item.file))
    const temp = join(target, `manifest.json.${process.pid}.tmp`)
    await writeFile(temp, JSON.stringify(manifest))
    await rename(temp, join(target, 'manifest.json'))
    prepared.push({ name, items: manifest.items.length })
  }
  return prepared
}
