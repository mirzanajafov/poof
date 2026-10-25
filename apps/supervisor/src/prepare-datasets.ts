import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { datasetNamePattern, parseManifest } from '@poof/contracts'
import { parseDatasetSource } from './datasets/dataset-source.js'
import { linkOrCopy } from './datasets/link-or-copy.js'

function exitWithUsage(problem: string): never {
  console.error(`${problem}\nusage: prepare-datasets --from <name>=<dir> [--from ...] --data <DATA_DIR>`)
  process.exit(1)
}

function readOptions() {
  try {
    return parseArgs({
      options: {
        from: { type: 'string', multiple: true },
        data: { type: 'string', default: process.env.DATA_DIR },
      },
    }).values
  } catch (error) {
    return exitWithUsage(String(error))
  }
}

const options = readOptions()
if (!options.from?.length) exitWithUsage('missing --from')
const data = options.data ?? exitWithUsage('missing --data, and DATA_DIR is not set')

const sources = options.from.map(
  (spec) =>
    parseDatasetSource(spec) ??
    exitWithUsage(`invalid --from ${spec}: expected <name>=<dir> with a name matching ${datasetNamePattern.source}`),
)
const repeated = sources.find(({ name }, index) => sources.findIndex((source) => source.name === name) !== index)
if (repeated) exitWithUsage(`two --from arguments share the name ${repeated.name}`)

const prepared = await Promise.all(
  sources.map(async ({ name, dir }) => {
    const path = join(dir, 'manifest.json')
    try {
      return { name, dir, manifest: parseManifest(await readFile(path, 'utf8'), path) }
    } catch (error) {
      return exitWithUsage(`cannot read --from ${name}=${dir}: ${String(error)}`)
    }
  }),
)

for (const { name, dir, manifest } of prepared) {
  const target = join(data, 'datasets', name)
  await mkdir(target, { recursive: true })
  for (const item of manifest.items) await linkOrCopy(join(dir, item.file), join(target, item.file))
  await writeFile(join(target, 'manifest.json'), JSON.stringify(manifest))
  console.log(`${name}: ${manifest.items.length} images`)
}
