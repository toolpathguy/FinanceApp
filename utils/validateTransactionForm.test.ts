import { describe, it, expect } from 'vitest'
import { validateTransactionForm } from './validateTransactionForm'
import type { TransactionFormState } from '../types/ui'

const validState: TransactionFormState = {
  date: '2025-01-15',
  description: 'Grocery store',
  postings: [
    { account: 'expenses:food', amount: '50.00', commodity: '$' },
    { account: 'assets:checking', amount: '', commodity: '$' },
  ],
  status: '*',
}

describe('validateTransactionForm', () => {
  it('returns empty array for a valid form', () => {
    expect(validateTransactionForm(validState)).toEqual([])
  })

  it('returns error when date is empty', () => {
    const errors = validateTransactionForm({ ...validState, date: '' })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some(e => e.toLowerCase().includes('date'))).toBe(true)
  })

  it('returns error when date does not match YYYY-MM-DD', () => {
    const errors = validateTransactionForm({ ...validState, date: '01-15-2025' })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some(e => e.toLowerCase().includes('date'))).toBe(true)
  })

  it('returns error when description is empty', () => {
    const errors = validateTransactionForm({ ...validState, description: '' })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some(e => e.toLowerCase().includes('description'))).toBe(true)
  })

  it('returns error when description is only whitespace', () => {
    const errors = validateTransactionForm({ ...validState, description: '   ' })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some(e => e.toLowerCase().includes('description'))).toBe(true)
  })

  it('returns error when fewer than 2 postings', () => {
    const errors = validateTransactionForm({
      ...validState,
      postings: [{ account: 'expenses:food', amount: '50', commodity: '$' }],
    })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some(e => e.toLowerCase().includes('posting'))).toBe(true)
  })

  it('returns error when a posting has empty account', () => {
    const errors = validateTransactionForm({
      ...validState,
      postings: [
        { account: 'expenses:food', amount: '50', commodity: '$' },
        { account: '', amount: '', commodity: '$' },
      ],
    })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some(e => e.toLowerCase().includes('account'))).toBe(true)
  })

  it('returns multiple errors when multiple fields are invalid', () => {
    const errors = validateTransactionForm({
      date: '',
      description: '',
      postings: [],
      status: '',
    })
    expect(errors.length).toBeGreaterThanOrEqual(3)
  })

  it('accepts date with valid YYYY-MM-DD format', () => {
    const errors = validateTransactionForm({ ...validState, date: '2000-12-31' })
    expect(errors).toEqual([])
  })

  it('rejects date with extra characters', () => {
    const errors = validateTransactionForm({ ...validState, date: '2025-01-15T00:00' })
    expect(errors.some(e => e.toLowerCase().includes('date'))).toBe(true)
  })
})
