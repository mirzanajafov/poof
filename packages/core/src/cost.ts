import type { PresetName } from './presets.ts'

export interface CostModel {
  coefMs: number
  exponent: number
  logResidualSd: number
}

export const serverCostModels: Record<PresetName, CostModel> = {
  'webp-1600': { coefMs: 151.8, exponent: 0.399, logResidualSd: 0.283 },
  'thumb-320': { coefMs: 15.97, exponent: 0.575, logResidualSd: 0.363 },
  'avif-1600': { coefMs: 3508.8, exponent: 0.183, logResidualSd: 0.497 },
}

export function costModelFor(models: Readonly<Record<string, CostModel>>, type: string): CostModel {
  const model = models[type]
  if (!model) throw new Error(`no cost model for ${type}`)
  return model
}

export function medianCostMs(model: CostModel, mp: number): number {
  return model.coefMs * mp ** model.exponent
}

export function expectedCostMs(model: CostModel, mp: number): number {
  return medianCostMs(model, mp) * Math.exp(model.logResidualSd ** 2 / 2)
}

export function predictedCostMs(preset: PresetName, image: { width: number; height: number }): number {
  return expectedCostMs(serverCostModels[preset], (image.width * image.height) / 1e6)
}
