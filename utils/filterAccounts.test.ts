import { describe, it, expect } from 'vitest'
import { filterRealAccounts, filterCategoryAccounts } from './filterAccounts'

describe('filterRealAccounts', () => {
  it('returns only assets: and liabilities: accounts', () => {
    const accounts = [
      'assets:checking',
      'assets:savings',
      'expenses:groceries',
      'expenses:dining',
      'income:salary',
      'liabilities:credit-card',
    ]
    expect(filterRealAccounts(accounts)).toEqual([
      'assets:checking',
      'assets:savings',
      'liabilities:credit-card',
    ])
  })

  it('returns empty array when no real accounts exist', () => {
    expect(filterRealAccounts(['expenses:food', 'income:salary'])).toEqual([])
  })

  it('returns empty array for empty input', () => {
    expect(filterRealAccounts([])).toEqual([])
  })

  it('preserves original order', () => {
    const accounts = ['liabilities:visa', 'assets:checking', 'liabilities:amex', 'assets:savings']
    expect(filterRealAccounts(accounts)).toEqual([
      'liabilities:visa',
      'assets:checking',
      'liabilities:amex',
      'assets:savings',
    ])
  })

  it('does not match partial prefixes', () => {
    expect(filterRealAccounts(['assetsmisc', 'liabilitiesother'])).toEqual([])
  })
})

describe('filterCategoryAccounts', () => {
  it('returns only expenses: and income: accounts', () => {
    const accounts = [
      'assets:checking',
      'expenses:groceries',
      'expenses:dining',
      'income:salary',
      'liabilities:credit-card',
    ]
    expect(filterCategoryAccounts(accounts)).toEqual([
      'expenses:groceries',
      'expenses:dining',
      'income:salary',
    ])
  })

  it('returns empty array when no category accounts exist', () => {
    expect(filterCategoryAccounts(['assets:checking', 'liabilities:visa'])).toEqual([])
  })

  it('returns empty array for empty input', () => {
    expect(filterCategoryAccounts([])).toEqual([])
  })

  it('preserves original order', () => {
    const accounts = ['income:salary', 'expenses:dining', 'income:bonus', 'expenses:rent']
    expect(filterCategoryAccounts(accounts)).toEqual([
      'income:salary',
      'expenses:dining',
      'income:bonus',
      'expenses:rent',
    ])
  })

  it('does not match partial prefixes', () => {
    expect(filterCategoryAccounts(['expensesmisc', 'incomeother'])).toEqual([])
  })
})

describe('disjointness', () => {
  it('real and category filters produce disjoint sets', () => {
    const accounts = [
      'assets:checking',
      'expenses:groceries',
      'income:salary',
      'liabilities:visa',
      'equity:opening',
    ]
    const real = filterRealAccounts(accounts)
    const category = filterCategoryAccounts(accounts)
    const overlap = real.filter(a => category.includes(a))
    expect(overlap).toEqual([])
  })
})
