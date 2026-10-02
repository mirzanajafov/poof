import sharp, { type Sharp } from 'sharp'

export type PresetName = 'webp-1600' | 'avif-1600' | 'thumb-320'

export interface Preset {
  name: PresetName
  ext: string
  apply(image: Sharp): Sharp
}

const fit1600 = { width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true } as const

export const presets: Record<PresetName, Preset> = {
  'webp-1600': {
    name: 'webp-1600',
    ext: 'webp',
    apply: (image) => image.resize(fit1600).webp({ quality: 80 }),
  },
  'avif-1600': {
    name: 'avif-1600',
    ext: 'avif',
    apply: (image) => image.resize(fit1600).avif({ quality: 50, effort: 4 }),
  },
  'thumb-320': {
    name: 'thumb-320',
    ext: 'jpg',
    apply: (image) => image.resize({ width: 320, height: 320, fit: 'cover' }).jpeg({ quality: 80 }),
  },
}

export const maxInputPixels = 100_000_000

export function presetByName(name: string): Preset {
  const preset = presets[name as PresetName]
  if (!preset) throw new Error(`unknown preset ${name}`)
  return preset
}

export function configureSharp(): void {
  sharp.concurrency(1)
  sharp.cache(false)
}

export function processItem(input: Buffer | string, preset: Preset): Promise<Buffer> {
  const image = sharp(input, { limitInputPixels: maxInputPixels, failOn: 'error' }).autoOrient()
  return preset.apply(image).toBuffer()
}
