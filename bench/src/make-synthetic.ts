import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import sharp from 'sharp'
import { mulberry32, type DatasetItem } from './dataset.ts'

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: 'data/synthetic' },
    count: { type: 'string', default: '100' },
    seed: { type: 'string', default: '1' },
    'min-mp': { type: 'string', default: '0.3' },
    'max-mp': { type: 'string', default: '60' },
    quality: { type: 'string', default: '90' },
  },
})

const aspects = [4 / 3, 3 / 2, 16 / 9, 1, 3 / 4, 2 / 3]
const octaves: Array<[scale: number, amplitude: number]> = [
  [64, 40],
  [16, 30],
  [4, 22],
  [1, 14],
]

type Rand = () => number

function noise(rand: Rand, width: number, height: number, channels: number, amplitude: number): Buffer {
  const data = Buffer.allocUnsafe(width * height * channels)
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.max(0, Math.min(255, Math.round(128 + (rand() * 2 - 1) * amplitude)))
  }
  return data
}

async function layer(rand: Rand, width: number, height: number, scale: number, channels: number, amplitude: number) {
  const w = Math.max(2, Math.round(width / scale))
  const h = Math.max(2, Math.round(height / scale))
  const small = noise(rand, w, h, channels, amplitude)
  if (scale === 1) return small
  return sharp(small, { raw: { width: w, height: h, channels: channels as 1 | 3 } })
    .resize(width, height, { fit: 'fill', kernel: 'cubic' })
    .toColourspace(channels === 1 ? 'b-w' : 'srgb')
    .raw()
    .toBuffer()
}

function shapes(rand: Rand, width: number, height: number): Buffer {
  const parts: string[] = []
  const color = () => `rgb(${Math.floor(rand() * 256)},${Math.floor(rand() * 256)},${Math.floor(rand() * 256)})`
  for (let i = 0; i < 24; i++) {
    const x = Math.round(rand() * width)
    const y = Math.round(rand() * height)
    const w = Math.round(rand() * width * 0.4) + 1
    const h = Math.round(rand() * height * 0.4) + 1
    const opacity = (0.2 + rand() * 0.6).toFixed(2)
    parts.push(
      rand() < 0.5
        ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color()}" fill-opacity="${opacity}"/>`
        : `<ellipse cx="${x}" cy="${y}" rx="${w}" ry="${h}" fill="${color()}" fill-opacity="${opacity}"/>`,
    )
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts.join('')}</svg>`)
}

async function render(rand: Rand, width: number, height: number, quality: number): Promise<Buffer> {
  const raw = { width, height, channels: 3 as const }
  let pixels = await sharp(await layer(rand, width, height, 256, 3, 110), { raw })
    .composite([{ input: shapes(rand, width, height), blend: 'over' }])
    .removeAlpha()
    .raw()
    .toBuffer()
  for (const [scale, amplitude] of octaves) {
    const detail = await layer(rand, width, height, scale, 1, amplitude)
    pixels = await sharp(pixels, { raw })
      .composite([{ input: detail, raw: { width, height, channels: 1 }, blend: 'overlay' }])
      .removeAlpha()
      .raw()
      .toBuffer()
  }
  return sharp(pixels, { raw }).jpeg({ quality }).toBuffer()
}

const out = values.out!
const count = Number(values.count)
const seed = Number(values.seed)
const minMp = Number(values['min-mp'])
const maxMp = Number(values['max-mp'])
const quality = Number(values.quality)

await mkdir(out, { recursive: true })
const items: DatasetItem[] = []
for (let i = 0; i < count; i++) {
  const rand = mulberry32(seed * 1000 + i)
  const mp = Math.exp(Math.log(minMp) + rand() * (Math.log(maxMp) - Math.log(minMp)))
  const aspect = aspects[Math.floor(rand() * aspects.length)]!
  const width = Math.round(Math.sqrt(mp * 1e6 * aspect) / 2) * 2
  const height = Math.round((mp * 1e6) / width / 2) * 2
  const started = performance.now()
  const jpeg = await render(rand, width, height, quality)
  const file = `syn-${String(i).padStart(3, '0')}-${width}x${height}.jpg`
  await writeFile(join(out, file), jpeg)
  items.push({ file, width, height, bytes: jpeg.length, mp: (width * height) / 1e6 })
  const bpp = ((jpeg.length * 8) / (width * height)).toFixed(2)
  console.log(`${file} ${(jpeg.length / 1e6).toFixed(1)} MB ${bpp} bpp ${Math.round(performance.now() - started)} ms`)
}
await writeFile(join(out, 'manifest.json'), `${JSON.stringify({ source: 'synthetic', items }, null, 2)}\n`)
