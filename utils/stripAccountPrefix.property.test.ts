import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { stripAccountPrefix } from './stripAccountPrefix'

/**
 * Arbitrary: generates a single non-empty account segment (lowercase alpha, 1-12 chars).
 * Mimics real hledger account segments like "checking", "groceries", "bank".
 */
const segmentArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,11}$/)

/**
 * Arbitrary: generates a colon-separated account path with 2-4 segments.
 * E.g. "expenses:groceries", "assets:bank:checking"
 */
const colonPathArb = fc
  .tuple(segmentArb, fc.array(segmentArb, { minLength: 1, maxLength: 3 }))
  .map(([prefix, rest]) => [prefix, ...rest].join(':'))

/**
 * Arbitrary: generates a single segment string with no colons.
 */
const noColonArb = segmentArb

function titleCase(s: string): string {
  if (s.length === 0) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

describe('stripAccountPrefix — Property Tests', () => {
  /**
   * Property 12: Strip account prefix behavior
   *
   * For any colon-separated hledger account path, stripAccountPrefix should remove
   * the first segment and title-case the remaining segments. For strings with no colon,
   * it should return the original string title-cased.
   *
   * **Validates: Requirements 7.1, 7.2**
   */

  it('Property 12a: for paths with colons, result should NOT contain the first segment and should be title-cased', () => {
    fc.assert(
      fc.property(colonPathArb, (path) => {
        const result = stripAccountPrefix(path)
        const segments = path.split(':')
        const firstSegment = segments[0]
        const remaining = segments.slice(1)

        // Result should not start with the first segment
        expect(result.toLowerCase().startsWith(firstSegment + ':')).toBe(false)

        // Result should be the remaining segments title-cased and joined with ": "
        const expected = remaining.map(titleCase).join(': ')
        expect(result).toBe(expected)
      }),
    )
  })

  it('Property 12b: for paths without colons, result should be the original string title-cased', () => {
    fc.assert(
      fc.property(noColonArb, (path) => {
        const result = stripAccountPrefix(path)
        expect(result).toBe(titleCase(path))
      }),
    )
  })

  it('Property 12c: result should never be empty if input is non-empty', () => {
    fc.assert(
      fc.property(
        fc.oneof(colonPathArb, noColonArb),
        (path) => {
          const result = stripAccountPrefix(path)
          expect(result.length).toBeGreaterThan(0)
        },
      ),
    )
  })
})
