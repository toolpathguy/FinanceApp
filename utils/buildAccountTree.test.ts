import { describe, it, expect } from 'vitest'
import { buildAccountTree } from './buildAccountTree'

describe('buildAccountTree', () => {
  it('returns empty array for empty input', () => {
    expect(buildAccountTree([])).toEqual([])
  })

  it('creates a single root node with defaultExpanded', () => {
    const result = buildAccountTree(['assets'])
    expect(result).toEqual([
      { label: 'assets', fullName: 'assets', defaultExpanded: true },
    ])
  })

  it('creates implicit parent nodes', () => {
    const result = buildAccountTree(['assets:checking'])
    expect(result).toHaveLength(1)
    expect(result[0]!.label).toBe('assets')
    expect(result[0]!.fullName).toBe('assets')
    expect(result[0]!.defaultExpanded).toBe(true)
    expect(result[0]!.children).toHaveLength(1)
    expect(result[0]!.children![0]).toEqual({
      label: 'checking',
      fullName: 'assets:checking',
    })
  })

  it('builds correct hierarchy from multiple accounts', () => {
    const result = buildAccountTree([
      'expenses:food:groceries',
      'expenses:food:restaurants',
      'assets:checking',
    ])

    expect(result).toHaveLength(2)

    const assets = result.find(n => n.label === 'assets')!
    expect(assets.defaultExpanded).toBe(true)
    expect(assets.children).toHaveLength(1)
    expect(assets.children![0]!.label).toBe('checking')

    const expenses = result.find(n => n.label === 'expenses')!
    expect(expenses.defaultExpanded).toBe(true)
    expect(expenses.children).toHaveLength(1)
    expect(expenses.children![0]!.label).toBe('food')
    expect(expenses.children![0]!.children).toHaveLength(2)
    expect(expenses.children![0]!.children![0]!.label).toBe('groceries')
    expect(expenses.children![0]!.children![1]!.label).toBe('restaurants')
  })

  it('sorts children alphabetically at every level', () => {
    const result = buildAccountTree([
      'expenses:transport',
      'assets:savings',
      'expenses:food',
      'assets:checking',
    ])

    // Root level sorted
    expect(result[0]!.label).toBe('assets')
    expect(result[1]!.label).toBe('expenses')

    // Children sorted
    expect(result[0]!.children![0]!.label).toBe('checking')
    expect(result[0]!.children![1]!.label).toBe('savings')
    expect(result[1]!.children![0]!.label).toBe('food')
    expect(result[1]!.children![1]!.label).toBe('transport')
  })

  it('sets defaultExpanded only on top-level nodes', () => {
    const result = buildAccountTree(['assets:checking:sub'])
    expect(result[0]!.defaultExpanded).toBe(true)
    expect(result[0]!.children![0]!.defaultExpanded).toBeUndefined()
    expect(result[0]!.children![0]!.children![0]!.defaultExpanded).toBeUndefined()
  })

  it('does not duplicate nodes when paths share prefixes', () => {
    const result = buildAccountTree([
      'assets',
      'assets:checking',
      'assets:savings',
    ])

    expect(result).toHaveLength(1)
    expect(result[0]!.children).toHaveLength(2)
  })
})
