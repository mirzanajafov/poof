export type DemoStep = 'poofed' | 'ran-exhibit'

export function reportStep(step: DemoStep): void {
  document.dispatchEvent(new CustomEvent('najafov:action', { detail: step }))
}
