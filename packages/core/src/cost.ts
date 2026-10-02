export interface CostModel {
  coefMs: number
  exponent: number
  logResidualSd: number
}

export const serverCostModels: Record<string, CostModel> = {
  'webp-1600': { coefMs: 151.8, exponent: 0.399, logResidualSd: 0.283 },
  'thumb-320': { coefMs: 15.97, exponent: 0.575, logResidualSd: 0.363 },
  'avif-1600': { coefMs: 3508.8, exponent: 0.183, logResidualSd: 0.497 },
}

export function medianCostMs(model: CostModel, mp: number): number {
  return model.coefMs * mp ** model.exponent
}

export function expectedCostMs(model: CostModel, mp: number): number {
  return medianCostMs(model, mp) * Math.exp(model.logResidualSd ** 2 / 2)
}
