import { afterEach, describe, expect, it, vi } from 'vitest'
import { reportStep } from './visit'

describe('visit', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('hands each step to the visit script as a najafov:action event on the document', () => {
    vi.stubGlobal('document', new EventTarget())
    const steps: unknown[] = []
    document.addEventListener('najafov:action', (event) => {
      steps.push(event instanceof CustomEvent ? event.detail : event)
    })

    reportStep('poofed')
    reportStep('ran-exhibit')

    expect(steps).toEqual(['poofed', 'ran-exhibit'])
  })
})
