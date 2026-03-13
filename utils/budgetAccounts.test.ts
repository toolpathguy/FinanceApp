import { describe, it, expect } from 'vitest'
import {
  toBudgetSubAccount,
  toUnallocatedAccount,
  isBudgetSubAccount,
  extractEnvelopeName,
} from './budgetAccounts'

/**
 * Unit tests for budget account naming utilities.
 * Validates: Requirements 12.1, 12.2, 12.3
 */

describe('toBudgetSubAccount()', () => {
  it('maps physical account + nested category to budget sub-account', () => {
    expect(toBudgetSubAccount('assets:checking', 'food:groceries'))
      .toBe('assets:checking:budget:food:groceries')
  })

  it('maps physical account + simple category to budget sub-account', () => {
    expect(toBudgetSubAccount('assets:checking', 'rent'))
      .toBe('assets:checking:budget:rent')
  })

  it('works with different physical accounts', () => {
    expect(toBudgetSubAccount('assets:savings', 'emergency'))
      .toBe('assets:savings:budget:emergency')
  })
})

describe('toUnallocatedAccount()', () => {
  it('returns unallocated account for checking', () => {
    expect(toUnallocatedAccount('assets:checking'))
      .toBe('assets:checking:budget:unallocated')
  })

  it('returns unallocated account for savings', () => {
    expect(toUnallocatedAccount('assets:savings'))
      .toBe('assets:savings:budget:unallocated')
  })
})

describe('isBudgetSubAccount()', () => {
  it('returns true for a simple budget sub-account', () => {
    expect(isBudgetSubAccount('assets:checking:budget:groceries')).toBe(true)
  })

  it('returns true for a nested budget sub-account', () => {
    expect(isBudgetSubAccount('assets:checking:budget:food:groceries')).toBe(true)
  })

  it('returns true for the unallocated budget account', () => {
    expect(isBudgetSubAccount('assets:checking:budget:unallocated')).toBe(true)
  })

  it('returns false for a physical account', () => {
    expect(isBudgetSubAccount('assets:checking')).toBe(false)
  })

  it('returns false for an expense account', () => {
    expect(isBudgetSubAccount('expenses:food')).toBe(false)
  })

  it('returns false for a liability account', () => {
    expect(isBudgetSubAccount('liabilities:credit-card')).toBe(false)
  })
})

describe('extractEnvelopeName()', () => {
  it('extracts nested category from budget sub-account', () => {
    expect(extractEnvelopeName('assets:checking:budget:food:groceries'))
      .toBe('food:groceries')
  })

  it('extracts unallocated from budget sub-account', () => {
    expect(extractEnvelopeName('assets:checking:budget:unallocated'))
      .toBe('unallocated')
  })

  it('extracts simple category from budget sub-account', () => {
    expect(extractEnvelopeName('assets:checking:budget:rent'))
      .toBe('rent')
  })

  it('returns full string if no :budget: marker found', () => {
    expect(extractEnvelopeName('assets:checking'))
      .toBe('assets:checking')
  })
})
