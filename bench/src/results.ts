import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { cpus, totalmem } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const resultsRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'results')

export function environment(label: string) {
  return {
    label,
    platform: process.platform,
    cpuModel: cpus()[0]?.model ?? 'unknown',
    logicalCpus: cpus().length,
    cpuLimit: process.env.CPU_LIMIT ? Number(process.env.CPU_LIMIT) : null,
    memoryGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
    node: process.version,
    sharp: sharp.versions.sharp,
    vips: sharp.versions.vips,
    at: new Date().toISOString(),
  }
}

export async function writeResult(label: string, name: string, data: unknown): Promise<string> {
  const path = join(resultsRoot, label, `${name}.json`)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`)
  return path
}

export async function readResult<T>(label: string, name: string): Promise<T> {
  return JSON.parse(await readFile(join(resultsRoot, label, `${name}.json`), 'utf8')) as T
}
