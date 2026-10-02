export interface Work {
  id: string
  deadline: number
  workMs: number
}

export function admits(candidate: Work, admitted: readonly Work[], now: number, capacity: number, slack = 0.9): boolean {
  const ordered = [...admitted, candidate].sort((a, b) => a.deadline - b.deadline || Number(a === candidate) - Number(b === candidate))
  let withCandidate = 0
  let without = 0
  for (const work of ordered) {
    withCandidate += work.workMs
    if (work !== candidate) without += work.workMs
    if (work.deadline < candidate.deadline) continue
    const room = capacity * (work.deadline - now) * slack
    if (work === candidate) {
      if (withCandidate > room) return false
    } else if (withCandidate > room && without <= room) {
      return false
    }
  }
  return true
}
