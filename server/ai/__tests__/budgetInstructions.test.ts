import { describe, it, expect } from 'vitest'
import { BUDGET_SYSTEM_PROMPT } from '../budgetInstructions'

describe('BUDGET_SYSTEM_PROMPT', () => {
  it('is a non-empty string', () => {
    expect(typeof BUDGET_SYSTEM_PROMPT).toBe('string')
    expect(BUDGET_SYSTEM_PROMPT.length).toBeGreaterThan(200)
  })

  it('carries the load-bearing propose-never-execute framing', () => {
    // These phrases encode the HITL safety contract — guard against silent drift.
    expect(BUDGET_SYSTEM_PROMPT).toMatch(/human-in-the-loop/i)
    expect(BUDGET_SYSTEM_PROMPT).toMatch(/propose/i)
    expect(BUDGET_SYSTEM_PROMPT).toMatch(/nothing is written until the user explicitly approves/i)
  })

  it('states YNAB Rule 1 and use-live-data guidance', () => {
    expect(BUDGET_SYSTEM_PROMPT).toMatch(/Ready to Assign/i)
    expect(BUDGET_SYSTEM_PROMPT).toMatch(/get_budget/)
  })
})
