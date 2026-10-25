import { describe, expect, it } from 'vitest'
import { parseManifest, parseTaskManifest } from '../src/datasets.ts'

const manifest = (items: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ ...extra, items })
const image = { file: 'a.jpg', width: 640, height: 480 }

describe('parseManifest', () => {
  it('keeps the source and the file and dimensions of every item and drops the rest', () => {
    const text = manifest([{ ...image, bytes: 1234, mp: 0.3072 }], { source: 'synthetic', origin: 'make-synthetic' })
    expect(parseManifest(text, 'm.json')).toEqual({ source: 'synthetic', items: [image] })
  })

  it('names the file when the text is not JSON or lists no items', () => {
    expect(() => parseManifest('{', 'data/x/manifest.json')).toThrow('data/x/manifest.json is not valid JSON')
    expect(() => parseManifest('{}', 'm.json')).toThrow('m.json lists no items')
    expect(() => parseManifest('[]', 'm.json')).toThrow('m.json lists no items')
    expect(() => parseManifest(manifest([]), 'm.json')).toThrow('m.json lists no items')
  })

  it('refuses a source that is not text', () => {
    expect(() => parseManifest(manifest([image], { source: 1 }), 'm.json')).toThrow(
      'm.json has a source that is not text',
    )
  })

  it('refuses a file name that would leave the dataset directory or replace its manifest', () => {
    for (const file of ['../secret.jpg', 'sub/a.jpg', 'sub\\a.jpg', '..', '.', 'manifest.json', '', 7]) {
      expect(() => parseManifest(manifest([{ ...image, file }]), 'm.json')).toThrow(
        'm.json: item 0 needs a plain file name',
      )
    }
  })

  it('reads a task manifest that lists only file names, with the same file name rule', () => {
    expect(parseTaskManifest(manifest([{ file: '0-a.jpg' }]), 'm.json')).toEqual({ items: [{ file: '0-a.jpg' }] })
    expect(() => parseTaskManifest(manifest([{ file: '../a.jpg' }]), 'm.json')).toThrow(
      'm.json: item 0 needs a plain file name',
    )
  })

  it('refuses dimensions that are not positive integers', () => {
    for (const [width, height] of [
      [0, 1],
      [1, -1],
      [1.5, 1],
      ['640', 480],
      [640, undefined],
    ]) {
      expect(() => parseManifest(manifest([image, { file: 'b.jpg', width, height }]), 'm.json')).toThrow(
        'm.json: item 1 needs a positive integer width and height',
      )
    }
  })
})
