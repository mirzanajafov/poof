export const presetNames = ['webp-1600', 'avif-1600', 'thumb-320'] as const

export type PresetName = (typeof presetNames)[number]

export function isPresetName(name: string): name is PresetName {
  const names: readonly string[] = presetNames
  return names.includes(name)
}
