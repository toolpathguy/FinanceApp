import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { formatAmount } from './formatAmount'

/**
 * Arbitrary: generates a commodity symbol (1–3 chars from common currency symbols and letters).
 */
const commodityArb = fc.stringMatching(/^[A-Z$€£¥]{1,3}$/)

/**
 * Arbitrary: generates a finite quantity number (avoiding NaN/Infinity).
 * Uses double in a reasonable range to exercise thousands separators and decimals.
 */
const quantityArb = fc.double({ min: -999_999_999, max: 999_999_999, noNaN: true })

/**
 * Arbitrary: generates an amount object with commodity and quantity.
 */
const amountArb = fc.record({
  commodity: commodityArb,
  quantity: quantityArb,
})

describe('formatAmount — Property Tests', () => {
  /**
   * Property 4: Amount formatting correctness
   *
   * For any { commodity, quantity } object, formatAmount returns a string that contains
   * the commodity symbol, formats the absolute quantity with exactly 2 decimal places
   * and thousands separators, and prefixes with `-` if and only if the quantity is negative.
   *
   * **Validates: Requirements 4.1, 4.2**
   */
  it('Property 4: result contains commodity, has 2 decimal places, and `-` prefix iff negative', () => {
    fc.assert(
      fc.property(amountArb, ({ commodity, quantity }) => {
        const result = formatAmount({ commodity, quantity })

        // Result must contain the commodity symbol
        expect(result).toContain(commodity)

        // Result must have exactly 2 decimal places
        const decimalMatch = result.match(/\.(\d+)$/)
        expect(decimalMatch).not.toBeNull()
        expect(decimalMatch![1]).toHaveLength(2)

        // Negative prefix: `-` iff quantity is negative
        if (quantity < 0) {
          expect(result.startsWith('-')).toBe(true)
        } else {
          expect(result.startsWith('-')).toBe(false)
        }

        // The formatted absolute value (digits, commas, dot, decimals) should be present
        const abs = Math.abs(quantity)
        const expectedFormatted = abs.toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
        expect(result).toContain(expectedFormatted)
      }),
    )
  })
})
