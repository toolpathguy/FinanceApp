import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { normalizeProposals } from '../importParse'

const CONTEXT = { accounts: ['assets:checking'], envelopes: ['rent'] }

/**
 * Property: for any row the normalizer accepts, the output amount is a positive
 * magnitude and the direction is preserved verbatim — sign never leaks into the
 * amount, and the normalizer never flips inflow/outflow (R6.2).
 */
describe('normalizeProposals — property', () => {
  it('accepted rows always have amount >= 0 and preserved direction', () => {
    fc.assert(
      fc.property(
        fc.float({ noNaN: true, min: Math.fround(-100000), max: Math.fround(100000) }),
        fc.constantFrom('inflow', 'outflow'),
        fc.string(),
        (amount, direction, payee) => {
          const { proposals } = normalizeProposals(
            { transactions: [{ date: '2026-06-17', payee, amount, direction, suggestedAccount: '', suggestedEnvelope: '', sourceRow: 'r' }] },
            CONTEXT, new Set(),
          )
          // amount 0 is rejected (dropped); any accepted row obeys the invariant.
          for (const p of proposals) {
            expect(p.amount).toBeGreaterThanOrEqual(0)
            expect(p.amount).toBe(Math.abs(p.amount))
            expect(p.direction).toBe(direction)
          }
        },
      ),
    )
  })
})
