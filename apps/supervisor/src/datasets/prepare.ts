import { access, constants, lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseManifest } from '@poof/contracts'
import type { DatasetSource } from './dataset-source.js'
import { replaceFile, replaceWithLinkOrCopy } from './files.js'

async function check({ name, dir }: DatasetSource) {
  const path = join(dir, 'manifest.json')
  const manifest = parseManifest(await readFile(path, 'utf8'), path)
  await Promise.all(manifest.items.map((item) => readableFile(join(dir, item.file))))
  return { name, dir, manifest }
}

async function readableFile(path: string): Promise<void> {
  if (!(await lstat(path)).isFile()) throw new Error(`${path} is not a regular file`)
  await access(path, constants.R_OK)
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
    await replaceFile(join(target, 'manifest.json'), (temp) => writeFile(temp, JSON.stringify(manifest)))
    prepared.push({ name, items: manifest.items.length })
  }
  return prepared
}
