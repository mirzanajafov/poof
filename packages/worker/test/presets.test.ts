import { outputFileName, presetNames } from '@poof/core'
import { presets, processItem } from '@poof/imaging'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

const extensions: Record<string, string> = { webp: 'webp', heif: 'avif', jpeg: 'jpg' }

describe('output files', () => {
  it('are named after the format each preset writes', async () => {
    const input = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#808080' } })
      .jpeg()
      .toBuffer()
    for (const name of presetNames) {
      const { format } = await sharp(await processItem(input, presets[name])).metadata()
      expect(outputFileName(0, name)).toBe(`0.${extensions[format]}`)
    }
  })
})
