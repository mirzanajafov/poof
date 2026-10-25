import { parseArgs } from 'node:util'
import { datasetNamePattern } from '@poof/contracts'
import { parseDatasetSource } from './datasets/dataset-source.js'
import { prepareDatasets } from './datasets/prepare.js'

function fail(problem: string): never {
  console.error(problem)
  process.exit(1)
}

function exitWithUsage(problem: string): never {
  return fail(`${problem}\nusage: prepare-datasets --from <name>=<dir> [--from ...] --data <DATA_DIR>`)
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
if (!options.data) exitWithUsage('missing --data, and DATA_DIR is not set')

const sources = options.from.map(
  (spec) =>
    parseDatasetSource(spec) ??
    exitWithUsage(`invalid --from ${spec}: expected <name>=<dir> with a name matching ${datasetNamePattern.source}`),
)
const repeated = sources.find(({ name }, index) => sources.findIndex((source) => source.name === name) !== index)
if (repeated) exitWithUsage(`two --from arguments share the name ${repeated.name}`)

const prepared = await prepareDatasets(sources, options.data).catch((error: unknown) => fail(String(error)))
for (const { name, items } of prepared) console.log(`${name}: ${items} images`)
