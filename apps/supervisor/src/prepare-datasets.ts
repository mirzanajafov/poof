import { copyFile, link, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { parseDatasetSource } from './datasets/dataset-source.js'

function exitWithUsage(problem: string): never {
  console.error(`${problem}\nusage: prepare-datasets --from <name>=<dir> [--from ...] --data <DATA_DIR>`)
  process.exit(1)
}

const { values } = parseArgs({
  options: {
    from: { type: 'string', multiple: true },
    data: { type: 'string', default: process.env.DATA_DIR },
  },
})

if (!values.from?.length || !values.data) exitWithUsage('missing --from or --data')

const sources = values.from.map(
  (spec) => parseDatasetSource(spec) ?? exitWithUsage(`invalid --from ${spec}: expected <name>=<dir> with a name of lowercase letters, digits and dashes`),
)

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
