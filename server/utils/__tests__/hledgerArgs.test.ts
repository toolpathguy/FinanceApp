import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { isValidDate, isValidPeriod, isValidAccount } from '../hledgerArgs'

describe('isValidDate', () => {
  it('accepts YYYY-MM-DD', () => {
    expect(isValidDate('2025-01-15')).toBe(true)
  })
  it('rejects non-dates and flag-like values', () => {
    expect(isValidDate('2025/01/15')).toBe(false)
    expect(isValidDate('--debug')).toBe(false)
    expect(isValidDate('-b')).toBe(false)
    expect(isValidDate('')).toBe(false)
  })
})

describe('isValidPeriod', () => {
  it('accepts common period expressions', () => {
    expect(isValidPeriod('2025-01')).toBe(true)
    expect(isValidPeriod('this month')).toBe(true)
    expect(isValidPeriod('2025/01-2025/02')).toBe(true)
  })
  it('rejects a leading dash and out-of-charset chars', () => {
    expect(isValidPeriod('-p')).toBe(false)
    expect(isValidPeriod('--debug')).toBe(false)
    expect(isValidPeriod('2025;rm')).toBe(false)
    expect(isValidPeriod('a'.repeat(41))).toBe(false)
  })
})

describe('isValidAccount', () => {
  it('accepts hledger account names', () => {
    expect(isValidAccount('assets:checking')).toBe(true)
    expect(isValidAccount('expenses:food:dining out')).toBe(true)
    expect(isValidAccount('assets:checking:budget:pending:credit-card')).toBe(true)
  })
  it('rejects a leading dash and shell/flag injection attempts', () => {
    expect(isValidAccount('-f')).toBe(false)
    expect(isValidAccount('--debug')).toBe(false)
    expect(isValidAccount('assets:checking;rm -rf')).toBe(false)
    expect(isValidAccount('a\nb')).toBe(false)
    expect(isValidAccount('')).toBe(false)
  })
})

describe('property: no validator accepts a flag-like value', () => {
  it('any string starting with "-" is rejected by every validator', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }).map((s) => '-' + s), (flagLike) => {
        expect(isValidDate(flagLike)).toBe(false)
        expect(isValidPeriod(flagLike)).toBe(false)
        expect(isValidAccount(flagLike)).toBe(false)
      }),
      { numRuns: 200 }
    )
  })

  it('accepted accounts never contain control or shell metacharacters', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        if (isValidAccount(s)) {
          expect(/[\r\n\t;|&$`<>]/.test(s)).toBe(false)
          expect(s.startsWith('-')).toBe(false)
        }
      }),
      { numRuns: 300 }
    )
  })
})
