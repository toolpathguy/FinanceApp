import { describe, it, expect } from 'vitest'
import { deriveTransactionType } from './deriveTransactionType'
import type { SimplifiedFormState } from '~/types/ui'

function makeFormState(overrides: Partial<SimplifiedFormState> = {}): SimplifiedFormState {
  return {
    date: '2025-01-15',
    payee: 'Test',
    account: 'assets:checking',
    category: '',
    transferAccount: '',
    inflow: '',
    outflow: '',
    status: '*',
    ...overrides,
  }
}

describe('deriveTransactionType', () => {
  it('returns "transfer" when transferAccount is non-empty', () => {
    const state = makeFormState({ transferAccount: 'assets:savings', inflow: '100' })
    expect(deriveTransactionType(state)).toBe('transfer')
  })

  it('returns "transfer" even when outflow is set alongside transferAccount', () => {
    const state = makeFormState({ transferAccount: 'assets:savings', outflow: '50' })
    expect(deriveTransactionType(state)).toBe('transfer')
  })

  it('returns "income" when inflow is non-empty and outflow is empty', () => {
    const state = makeFormState({ inflow: '2000' })
    expect(deriveTransactionType(state)).toBe('income')
  })

  it('returns "expense" when outflow is non-empty and inflow is empty', () => {
    const state = makeFormState({ outflow: '5.00' })
    expect(deriveTransactionType(state)).toBe('expense')
  })

  it('returns "expense" when both inflow and outflow are empty', () => {
    const state = makeFormState()
    expect(deriveTransactionType(state)).toBe('expense')
  })

  it('throws when both inflow and outflow are filled and no transferAccount', () => {
    const state = makeFormState({ inflow: '100', outflow: '50' })
    expect(() => deriveTransactionType(state)).toThrow('both inflow and outflow are filled')
  })

  it('transfer takes priority over inflow/outflow conflict', () => {
    const state = makeFormState({ transferAccount: 'assets:savings', inflow: '100', outflow: '50' })
    expect(deriveTransactionType(state)).toBe('transfer')
  })
})
