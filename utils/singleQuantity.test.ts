import { describe, it, expect } from 'vitest'
import { singleQuantity, MultiCommodityError } from './singleQuantity'

describe('singleQuantity()', () => {
  it('returns the lone quantity for a single-commodity amount list', () => {
    expect(singleQuantity([{ commodity: '$', quantity: 42.5 }], 'test')).toBe(42.5)
  })

  it('returns 0 for an empty list', () => {
    expect(singleQuantity([], 'test')).toBe(0)
  })

  it('returns 0 for undefined', () => {
    expect(singleQuantity(undefined, 'test')).toBe(0)
  })

  it('throws MultiCommodityError for two or more commodities', () => {
    expect(() =>
      singleQuantity([{ commodity: '$', quantity: 1 }, { commodity: '€', quantity: 2 }], 'savings'),
    ).toThrow(MultiCommodityError)
  })

  it('names the context and commodities in the error', () => {
    try {
      singleQuantity([{ commodity: '$', quantity: 1 }, { commodity: '€', quantity: 2 }], 'savings')
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(MultiCommodityError)
      const e = err as MultiCommodityError
      expect(e.context).toBe('savings')
      expect(e.commodities).toEqual(['$', '€'])
      expect(e.message).toContain('savings')
      expect(e.message).toContain('$')
      expect(e.message).toContain('€')
    }
  })
})
