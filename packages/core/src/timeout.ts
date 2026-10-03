export interface TimeoutRule {
  floorMs: number
  multiple: number
  growth: number
}

export const defaultTimeoutRule: TimeoutRule = { floorMs: 5000, multiple: 10, growth: 2 }

export function itemTimeoutMs(
  predicted: ArrayLike<number>,
  from: number,
  to: number,
  scale: number,
  attempts: (item: number) => number,
  rule: TimeoutRule = defaultTimeoutRule,
): number {
  let limit = rule.floorMs
  for (let i = from; i < to; i++) {
    limit = Math.max(limit, rule.multiple * predicted[i]! * scale * rule.growth ** attempts(i))
  }
  return limit
}
