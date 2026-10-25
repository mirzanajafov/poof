import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { linkOrCopy } from './link-or-copy.js'

describe('linkOrCopy', () => {
  it('replaces a file that is already at the target', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'poof-link-'))
    const source = join(dir, 'source.jpg')
    const target = join(dir, 'target.jpg')
    await writeFile(source, 'new')
    await writeFile(target, 'stale')
    await linkOrCopy(source, target)
    expect(await readFile(target, 'utf8')).toBe('new')
    await rm(dir, { recursive: true, force: true })
  })
})
