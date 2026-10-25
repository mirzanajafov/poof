import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { linkOrCopy } from './link-or-copy.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'poof-link-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('linkOrCopy', () => {
  it('replaces a file that is already at the target', async () => {
    await writeFile(join(dir, 'source.jpg'), 'new')
    await writeFile(join(dir, 'target.jpg'), 'stale')
    await linkOrCopy(join(dir, 'source.jpg'), join(dir, 'target.jpg'))
    expect(await readFile(join(dir, 'target.jpg'), 'utf8')).toBe('new')
  })

  it('keeps the file when the source is the target', async () => {
    await writeFile(join(dir, 'image.jpg'), 'only copy')
    await linkOrCopy(join(dir, 'image.jpg'), join(dir, 'image.jpg'))
    expect(await readFile(join(dir, 'image.jpg'), 'utf8')).toBe('only copy')
  })
})
