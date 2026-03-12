import { describe, it, expect } from 'vitest'
import { toTransactionInput, formStateToInput } from './toTransactionInput'
import type { SimplifiedTransactionInput, SimplifiedFormState } from '~/types/ui'

describe('toTransactionInput', () => {
  it('converts an expense to 2 balanced postings', () => {
    const input: SimplifiedTransactionInput = {
      date: '2025-01-15',
      payee: 'Coffee Shop',
      account: 'assets:checking',
      type: 'expense',
      category: 'expenses:dining',
      amount: 5,
    }

    const result = toTransactionInput(input)

    expect(result.postings).toHaveLength(2)
    expect(result.postings[0]).toEqual({ account: 'expenses:dining', amount: 5, commodity: '$' })
    expect(result.postings[1]).toEqual({ account: 'assets:checking', amount: -5, commodity: '$' })
    expect(result.postings[0].amount! + result.postings[1].amount!).toBe(0)
    expect(result.description).toBe('Coffee Shop')
    expect(result.date).toBe('2025-01-15')
    expect(result.status).toBe('*')
  })

  it('converts an income to 2 balanced postings', () => {
    const input: SimplifiedTransactionInput = {
      date: '2025-01-16',
      payee: 'Employer',
      account: 'assets:checking',
      type: 'income',
      category: 'income:salary',
      amount: 2000,
    }

    const result = toTransactionInput(input)

    expect(result.postings).toHaveLength(2)
    expect(result.postings[0]).toEqual({ account: 'assets:checking', amount: 2000, commodity: '$' })
    expect(result.postings[1]).toEqual({ account: 'income:salary', amount: -2000, commodity: '$' })
    expect(result.postings[0].amount! + result.postings[1].amount!).toBe(0)
    expect(result.description).toBe('Employer')
    expect(result.date).toBe('2025-01-16')
  })

  it('converts a transfer to 2 balanced postings', () => {
    const input: SimplifiedTransactionInput = {
      date: '2025-01-17',
      payee: 'Transfer',
      account: 'assets:checking',
      type: 'transfer',
      transferAccount: 'assets:savings',
      amount: 500,
    }

    const result = toTransactionInput(input)

    expect(result.postings).toHaveLength(2)
    expect(result.postings[0]).toEqual({ account: 'assets:savings', amount: 500, commodity: '$' })
    expect(result.postings[1]).toEqual({ account: 'assets:checking', amount: -500, commodity: '$' })
    expect(result.postings[0].amount! + result.postings[1].amount!).toBe(0)
  })

  it('uses provided commodity and status', () => {
    const input: SimplifiedTransactionInput = {
      date: '2025-01-15',
      payee: 'Test',
      account: 'assets:checking',
      type: 'expense',
      category: 'expenses:food',
      amount: 10,
      commodity: '€',
      status: '!',
    }

    const result = toTransactionInput(input)

    expect(result.postings[0].commodity).toBe('€')
    expect(result.postings[1].commodity).toBe('€')
    expect(result.status).toBe('!')
  })

  it('defaults commodity to $ and status to *', () => {
    const input: SimplifiedTransactionInput = {
      date: '2025-01-15',
      payee: 'Test',
      account: 'assets:checking',
      type: 'expense',
      category: 'expenses:food',
      amount: 10,
    }

    const result = toTransactionInput(input)

    expect(result.postings[0].commodity).toBe('$')
    expect(result.status).toBe('*')
  })
})

describe('formStateToInput', () => {
  it('converts an expense form state', () => {
    const state: SimplifiedFormState = {
      date: '2025-01-15',
      payee: 'Coffee Shop',
      account: 'assets:checking',
      category: 'expenses:dining',
      transferAccount: '',
      inflow: '',
      outflow: '5.00',
      status: '*',
    }

    const result = formStateToInput(state)

    expect(result.type).toBe('expense')
    expect(result.amount).toBe(5)
    expect(result.category).toBe('expenses:dining')
    expect(result.transferAccount).toBeUndefined()
    expect(result.payee).toBe('Coffee Shop')
    expect(result.date).toBe('2025-01-15')
  })

  it('converts an income form state', () => {
    const state: SimplifiedFormState = {
      date: '2025-01-16',
      payee: 'Employer',
      account: 'assets:checking',
      category: 'income:salary',
      transferAccount: '',
      inflow: '2000',
      outflow: '',
      status: '*',
    }

    const result = formStateToInput(state)

    expect(result.type).toBe('income')
    expect(result.amount).toBe(2000)
    expect(result.category).toBe('income:salary')
    expect(result.transferAccount).toBeUndefined()
  })

  it('converts a transfer form state', () => {
    const state: SimplifiedFormState = {
      date: '2025-01-17',
      payee: 'Transfer',
      account: 'assets:checking',
      category: '',
      transferAccount: 'assets:savings',
      inflow: '',
      outflow: '500',
      status: '',
    }

    const result = formStateToInput(state)

    expect(result.type).toBe('transfer')
    expect(result.amount).toBe(500)
    expect(result.transferAccount).toBe('assets:savings')
    expect(result.category).toBeUndefined()
    expect(result.status).toBe('')
  })
})
