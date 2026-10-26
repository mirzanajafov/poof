export const presetNames = ['webp-1600', 'avif-1600', 'thumb-320'] as const

export type PresetName = (typeof presetNames)[number]

const presetExtensions: Record<PresetName, string> = {
  'webp-1600': 'webp',
  'avif-1600': 'avif',
  'thumb-320': 'jpg',
}

export function outputFileName(item: number, preset: PresetName): string {
  return `${item}.${presetExtensions[preset]}`
}

export function isPresetName(name: string): name is PresetName {
  const names: readonly string[] = presetNames
  return names.includes(name)
}
