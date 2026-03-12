import { describe, it, expect } from 'vitest'
import { formatAmount } from './formatAmount'

describe('formatAmount', () => {
  it('formats a positive amount with commodity symbol', () => {
    expect(formatAmount({ commodity: '$', quantity: 1234.56 })).toBe('$1,234.56')
  })

  it('formats a negative amount with dash before commodity', () => {
    expect(formatAmount({ commodity: '$', quantity: -42 })).toBe('-$42.00')
  })

  it('formats zero as commodity followed by 0.00', () => {
    expect(formatAmount({ commodity: '$', quantity: 0 })).toBe('$0.00')
  })

  it('formats with 2 decimal places', () => {
    expect(formatAmount({ commodity: '$', quantity: 5 })).toBe('$5.00')
  })

  it('adds thousands separators', () => {
    expect(formatAmount({ commodity: '$', quantity: 1000000 })).toBe('$1,000,000.00')
  })

  it('handles non-dollar commodity symbols', () => {
    expect(formatAmount({ commodity: '€', quantity: 99.9 })).toBe('€99.90')
  })

  it('handles negative zero as positive', () => {
    expect(formatAmount({ commodity: '$', quantity: -0 })).toBe('$0.00')
  })
})
