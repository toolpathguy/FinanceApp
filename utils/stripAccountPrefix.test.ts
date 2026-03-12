import { describe, it, expect } from 'vitest'
import { stripAccountPrefix } from './stripAccountPrefix'

describe('stripAccountPrefix', () => {
  it('removes first segment and title-cases for single remaining segment', () => {
    expect(stripAccountPrefix('expenses:groceries')).toBe('Groceries')
  })

  it('removes first segment and title-cases multiple remaining segments', () => {
    expect(stripAccountPrefix('assets:bank:checking')).toBe('Bank: Checking')
  })

  it('returns original string title-cased when no colon found', () => {
    expect(stripAccountPrefix('checking')).toBe('Checking')
  })

  it('handles already title-cased input', () => {
    expect(stripAccountPrefix('assets:Savings')).toBe('Savings')
  })

  it('handles liabilities prefix', () => {
    expect(stripAccountPrefix('liabilities:credit-card')).toBe('Credit-card')
  })

  it('handles income prefix', () => {
    expect(stripAccountPrefix('income:salary')).toBe('Salary')
  })

  it('handles deeply nested paths', () => {
    expect(stripAccountPrefix('expenses:food:dining:restaurants')).toBe('Food: Dining: Restaurants')
  })
})
