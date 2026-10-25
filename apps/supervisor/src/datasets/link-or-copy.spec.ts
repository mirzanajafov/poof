import { link, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { replaceWithLinkOrCopy } from './link-or-copy.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'poof-link-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('replaceWithLinkOrCopy', () => {
  it('replaces a file that is already at the target', async () => {
    await writeFile(join(dir, 'source.jpg'), 'new')
    await writeFile(join(dir, 'target.jpg'), 'stale')
    await replaceWithLinkOrCopy(join(dir, 'source.jpg'), join(dir, 'target.jpg'))
    expect(await readFile(join(dir, 'target.jpg'), 'utf8')).toBe('new')
    expect((await readdir(dir)).sort()).toEqual(['source.jpg', 'target.jpg'])
  })

  it('leaves the file alone when the source is the target or already linked to it', async () => {
    await writeFile(join(dir, 'image.jpg'), 'only copy')
    await link(join(dir, 'image.jpg'), join(dir, 'linked.jpg'))
    await replaceWithLinkOrCopy(join(dir, 'image.jpg'), join(dir, 'image.jpg'))
    await replaceWithLinkOrCopy(join(dir, 'image.jpg'), join(dir, 'linked.jpg'))
    expect(await readFile(join(dir, 'image.jpg'), 'utf8')).toBe('only copy')
    expect((await readdir(dir)).sort()).toEqual(['image.jpg', 'linked.jpg'])
  })
})
