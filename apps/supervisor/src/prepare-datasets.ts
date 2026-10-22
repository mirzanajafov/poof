import { copyFile, link, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { parseDatasetSource } from './datasets/dataset-source.js'

const { values } = parseArgs({
  options: {
    from: { type: 'string', multiple: true },
    data: { type: 'string', default: process.env.DATA_DIR },
  },
})

const sources = values.from?.map(parseDatasetSource) ?? []

if (!sources.length || !sources.every((source) => source !== undefined) || !values.data) {
  console.error('usage: prepare-datasets --from <name>=<dir> [--from ...] --data <DATA_DIR>')
  process.exit(1)
}

for (const { name, dir } of sources) {
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as {
    items: Array<{ file: string; width: number; height: number }>
  }
  const target = join(values.data, 'datasets', name)
  await mkdir(target, { recursive: true })
  for (const item of manifest.items) {
    const source = join(dir, item.file)
    const destination = join(target, item.file)
    await link(source, destination).catch((error: NodeJS.ErrnoException) =>
      error.code === 'EEXIST' ? undefined : copyFile(source, destination),
    )
  }
  const items = manifest.items.map(({ file, width, height }) => ({ file, width, height }))
  await writeFile(join(target, 'manifest.json'), JSON.stringify({ items }))
  console.log(`${name}: ${items.length} images`)
}
