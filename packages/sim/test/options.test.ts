import { describe, expect, it } from 'vitest'
import { count, knownNames } from '../src/options.ts'

describe('count', () => {
  it('reads a whole number above zero', () => {
    expect(count('seeds', '20')).toBe(20)
  })

  it('refuses zero, fractions and text, which used to leave the worker pool waiting forever', () => {
    expect(() => count('seeds', '0')).toThrow('--seeds needs a whole number above zero, not 0')
    expect(() => count('threads', '1.5')).toThrow('--threads needs a whole number above zero, not 1.5')
    expect(() => count('dt', 'ten')).toThrow('--dt needs a whole number above zero, not ten')
  })
})

describe('knownNames', () => {
  it('keeps the names in the order given', () => {
    expect(knownNames('c4,cage', ['cage', 'c2', 'c4'], 'machine')).toEqual(['c4', 'cage'])
  })

  it('lists every unknown name at once', () => {
    expect(() => knownNames('cage,c8,c16', ['cage', 'c2', 'c4'], 'machine')).toThrow('unknown machine c8, c16')
  })
})
