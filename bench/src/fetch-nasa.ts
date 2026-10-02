import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import sharp from 'sharp'
import type { DatasetItem } from './dataset.ts'

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: 'data/nasa' },
    count: { type: 'string', default: '40' },
    'max-mb': { type: 'string', default: '30' },
  },
})

const queries = [
  'iss earth observation',
  'expedition crew earth',
  'artemis launch',
  'astronaut spacewalk',
  'kennedy space center',
  'aurora from space',
  'mars rover',
  'hubble',
]

interface SearchResult {
  collection: { items: Array<{ data: Array<{ nasa_id: string; title: string; description?: string }> }> }
}

interface AssetResult {
  collection: { items: Array<{ href: string }> }
}

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return (await res.json()) as T
}

const out = values.out!
const count = Number(values.count)
const maxBytes = Number(values['max-mb']) * 1e6
const perQuery = Math.ceil(count / queries.length)

await mkdir(out, { recursive: true })
const items: Array<DatasetItem & { nasaId: string; title: string }> = []
for (const query of queries) {
  const search = await json<SearchResult>(
    `https://images-api.nasa.gov/search?q=${encodeURIComponent(query)}&media_type=image&page_size=60`,
  )
  let taken = 0
  for (const entry of search.collection.items) {
    if (taken >= perQuery || items.length >= count) break
    const data = entry.data[0]
    if (!data || /©|copyright/i.test(data.description ?? '')) continue
    if (items.some((item) => item.nasaId === data.nasa_id)) continue
    const asset = await json<AssetResult>(`https://images-api.nasa.gov/asset/${encodeURIComponent(data.nasa_id)}`)
    const orig = asset.collection.items.map((item) => item.href).find((href) => /~orig\.jpe?g$/i.test(href))
    if (!orig) continue
    const url = orig.replace(/^http:/, 'https:')
    const head = await fetch(url, { method: 'HEAD' })
    const size = Number(head.headers.get('content-length'))
    if (!head.ok || !size || size > maxBytes || size < 200_000) continue
    const body = Buffer.from(await (await fetch(url)).arrayBuffer())
    const meta = await sharp(body).metadata()
    if (meta.format !== 'jpeg' || !meta.width || !meta.height) continue
    const file = `nasa-${data.nasa_id.replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`
    await writeFile(join(out, file), body)
    items.push({
      file,
      width: meta.width,
      height: meta.height,
      bytes: body.length,
      mp: (meta.width * meta.height) / 1e6,
      nasaId: data.nasa_id,
      title: data.title,
    })
    taken++
    const bpp = ((body.length * 8) / (meta.width * meta.height)).toFixed(2)
    console.log(`${file} ${meta.width}x${meta.height} ${(body.length / 1e6).toFixed(1)} MB ${bpp} bpp`)
  }
}
await writeFile(
  join(out, 'manifest.json'),
  `${JSON.stringify({ source: 'nasa', origin: 'images-api.nasa.gov originals', items }, null, 2)}\n`,
)
