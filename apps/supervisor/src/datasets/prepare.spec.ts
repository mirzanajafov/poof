import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prepareDatasets } from './prepare.js'

let root: string

async function source(name: string, files: string[], listed = files): Promise<string> {
  const dir = join(root, 'sources', name)
  await mkdir(dir, { recursive: true })
  for (const file of files) await writeFile(join(dir, file), `image ${file}`)
  const items = listed.map((file) => ({ file, width: 640, height: 480 }))
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({ items }))
  return dir
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'poof-prepare-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('prepareDatasets', () => {
  it('links every image and writes the manifest', async () => {
    const dir = await source('small', ['a.jpg', 'b.jpg'])
    const data = join(root, 'data')
    expect(await prepareDatasets([{ name: 'small', dir }], data)).toEqual([{ name: 'small', items: 2 }])
    expect((await readdir(join(data, 'datasets', 'small'))).sort()).toEqual(['a.jpg', 'b.jpg', 'manifest.json'])
  })

  it('writes nothing until every source checks out', async () => {
    const good = await source('good', ['a.jpg'])
    const broken = await source('broken', ['a.jpg'], ['a.jpg', 'missing.jpg'])
    const data = join(root, 'data')
    await expect(
      prepareDatasets(
        [
          { name: 'good', dir: good },
          { name: 'broken', dir: broken },
        ],
        data,
      ),
    ).rejects.toThrow(/missing\.jpg/)
    await expect(readdir(data)).rejects.toThrow(/ENOENT/)
  })

  it('refuses a source that lists a directory as an image', async () => {
    const dir = await source('odd', ['a.jpg'], ['a.jpg', 'nested'])
    await mkdir(join(dir, 'nested'))
    await expect(prepareDatasets([{ name: 'odd', dir }], join(root, 'data'))).rejects.toThrow(
      /nested is not a regular file/,
    )
  })

  it('prepares a dataset over itself without losing an image', async () => {
    const data = join(root, 'data')
    await prepareDatasets([{ name: 'small', dir: await source('small', ['a.jpg']) }], data)
    const prepared = join(data, 'datasets', 'small')
    await prepareDatasets([{ name: 'small', dir: prepared }], data)
    expect(await readFile(join(prepared, 'a.jpg'), 'utf8')).toBe('image a.jpg')
    expect((await readdir(prepared)).sort()).toEqual(['a.jpg', 'manifest.json'])
  })
})
