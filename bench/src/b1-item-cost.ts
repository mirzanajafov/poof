import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { configureSharp, presetByName, processItem } from '@poof/imaging'
import { itemPath, loadDataset, shuffled, type DatasetItem } from './dataset.ts'
import { cpuMsSince, peakRssMb, resetPeakRss, rssMb } from './memory.ts'
import { environment, writeResult } from './results.ts'
import { linearFit, median, round, summary } from './stats.ts'

const { values } = parseArgs({
  options: {
    data: { type: 'string', multiple: true, default: ['data/synthetic'] },
    presets: { type: 'string', default: 'webp-1600,avif-1600,thumb-320' },
    passes: { type: 'string', default: '2' },
    'avif-passes': { type: 'string', default: '1' },
    warmup: { type: 'string', default: '5' },
    label: { type: 'string', default: 'local' },
  },
})

interface Sample {
  source: string
  file: string
  mp: number
  bytes: number
  preset: string
  pass: number
  readMs: number
  wallMs: number
  cpuMs: number
  peakRssMb: number
  outBytes: number
}

configureSharp()
const baseRssMb = rssMb()
const datasets = await Promise.all(values.data!.map((dir) => loadDataset(dir)))
const samples: Sample[] = []

for (const name of values.presets!.split(',')) {
  const preset = presetByName(name)
  const passes = Number(name.startsWith('avif') ? values['avif-passes'] : values.passes)
  for (const dataset of datasets) {
    for (const item of dataset.items.slice(0, Number(values.warmup))) {
      await processItem(await readFile(itemPath(dataset, item)), preset)
    }
    for (let pass = 1; pass <= passes; pass++) {
      for (const item of shuffled(dataset.items, pass)) {
        const readStart = performance.now()
        const input = await readFile(itemPath(dataset, item))
        const readMs = performance.now() - readStart
        resetPeakRss()
        const cpuStart = process.cpuUsage()
        const started = performance.now()
        const output = await processItem(input, preset)
        samples.push({
          source: dataset.source,
          file: item.file,
          mp: item.mp,
          bytes: item.bytes,
          preset: name,
          pass,
          readMs,
          wallMs: performance.now() - started,
          cpuMs: cpuMsSince(cpuStart),
          peakRssMb: peakRssMb(),
          outBytes: output.length,
        })
      }
      console.log(`${name} ${dataset.source} pass ${pass} done`)
    }
  }
}

function perImage(preset: string, source: string) {
  const byFile = new Map<string, { item: Pick<DatasetItem, 'file' | 'mp'>; wall: number[]; rss: number[] }>()
  for (const s of samples) {
    if (s.preset !== preset || s.source !== source) continue
    const entry = byFile.get(s.file) ?? { item: { file: s.file, mp: s.mp }, wall: [], rss: [] }
    entry.wall.push(s.wallMs)
    entry.rss.push(s.peakRssMb)
    byFile.set(s.file, entry)
  }
  return [...byFile.values()].map((e) => ({
    file: e.item.file,
    mp: e.item.mp,
    wallMs: median(e.wall),
    peakRssMb: Math.max(...e.rss),
  }))
}

const fits: Record<string, Record<string, unknown>> = {}
for (const name of values.presets!.split(',')) {
  fits[name] = {}
  for (const dataset of datasets) {
    const images = perImage(name, dataset.source)
    const cost = linearFit(
      images.map((i) => i.mp),
      images.map((i) => i.wallMs),
    )
    const memory = linearFit(
      images.map((i) => i.mp),
      images.map((i) => i.peakRssMb),
    )
    fits[name]![dataset.source] = {
      images: images.length,
      wallMs: summary(images.map((i) => i.wallMs)),
      msPerMp: summary(images.map((i) => i.wallMs / i.mp)),
      costFit: { interceptMs: round(cost.intercept), msPerMp: round(cost.slope), r2: round(cost.r2), logResidualSd: round(cost.logResidualSd) },
      rssFit: { interceptMb: round(memory.intercept), mbPerMp: round(memory.slope), r2: round(memory.r2) },
    }
    console.log(name, dataset.source, JSON.stringify(fits[name]![dataset.source]))
  }
}

const path = await writeResult(values.label!, 'b1-item-cost', {
  env: environment(values.label!),
  baseRssMb: round(baseRssMb),
  fits,
  samples: samples.map((s) => ({ ...s, readMs: round(s.readMs), wallMs: round(s.wallMs), cpuMs: round(s.cpuMs), peakRssMb: round(s.peakRssMb) })),
})
console.log(`wrote ${path}`)
