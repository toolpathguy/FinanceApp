import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Hoisted mock state (referenced inside vi.mock factories) ---
const h = vi.hoisted(() => ({
  createMock: vi.fn(),
  appendMock: vi.fn(),
  budgetMock: vi.fn(),
  txMock: vi.fn(),
  state: { keyConfigured: true },
}))

class FakeMissingApiKeyError extends Error {}

vi.mock('../../../utils/anthropic', () => ({
  getAnthropic: () => {
    if (!h.state.keyConfigured) throw new FakeMissingApiKeyError()
    return { messages: { create: h.createMock } }
  },
  MissingApiKeyError: FakeMissingApiKeyError,
  REQUEST_DEFAULTS: { model: 'claude-opus-4-8', max_tokens: 4096 },
}))

// Leaf data utils used by the read-tool handlers.
vi.mock('../../../utils/budgetReport', () => ({ getBudgetReport: (...a: any[]) => h.budgetMock(...a) }))
vi.mock('../../../utils/transactionList', () => ({ getTransactionList: (...a: any[]) => h.txMock(...a) }))

// The journal writer — proving the loop NEVER writes (R6.1). The chat route graph
// must never reach this.
vi.mock('../../../utils/journalWriter', () => ({ appendTransaction: (...a: any[]) => h.appendMock(...a) }))

// Nitro globals + the auto-imported budget-base resolver used by toProposedAction.
vi.stubGlobal('defineEventHandler', (fn: Function) => fn)
vi.stubGlobal('readBody', async (event: any) => event.body)
vi.stubGlobal('createError', (opts: any) => Object.assign(new Error(opts.statusMessage || opts.message), opts))
vi.stubGlobal('resolveBudgetBase', async () => 'assets:checking')

const { default: chat } = await import('../chat.post')

const ev = (body: any) => ({ body } as any)
const text = (t: string) => ({ type: 'text', text: t })
const toolUse = (id: string, name: string, input: any) => ({ type: 'tool_use', id, name, input })

beforeEach(() => {
  vi.clearAllMocks()
  h.state.keyConfigured = true
})

describe('POST /api/ai/chat — HITL safety (R6.1)', () => {
  it('surfaces an assign proposal WITHOUT writing to the journal', async () => {
    h.createMock.mockResolvedValueOnce({
      stop_reason: 'tool_use',
      content: [text('I can assign that.'), toolUse('toolu_a', 'assign_to_envelope', { envelopes: { rent: 100 } })],
    })

    const res = await chat(ev({ message: 'assign 100 to rent' }))

    // The load-bearing guarantee: nothing was written.
    expect(h.appendMock).not.toHaveBeenCalled()
    // The loop paused on the proposal — no second model call.
    expect(h.createMock).toHaveBeenCalledTimes(1)
    expect(res.proposedActions).toHaveLength(1)
    expect(res.proposedActions[0]!.kind).toBe('assign')
    expect(res.proposedActions[0]!.id).toBe('toolu_a')
    expect(res.reply).toContain('assign')
  })
})

describe('read-tool dispatch', () => {
  it('executes get_budget, feeds the result back, and continues to a final reply', async () => {
    h.budgetMock.mockResolvedValue({ readyToAssign: 250 })
    h.createMock
      .mockResolvedValueOnce({ stop_reason: 'tool_use', content: [toolUse('toolu_b', 'get_budget', {})] })
      .mockResolvedValueOnce({ stop_reason: 'end_turn', content: [text('You have $250 to assign.')] })

    const res = await chat(ev({ message: 'how much can I assign?' }))

    expect(h.budgetMock).toHaveBeenCalledOnce()
    expect(h.createMock).toHaveBeenCalledTimes(2)
    expect(res.proposedActions).toHaveLength(0)
    expect(res.reply).toBe('You have $250 to assign.')
    // The history carries a tool_result turn for the read tool (search, not index:
    // `messages` is one mutated array, so the final assistant turn is last).
    const readResultTurn = res.messages.find((m: any) =>
      m.role === 'user' && Array.isArray(m.content) && m.content[0]?.tool_use_id === 'toolu_b')
    expect(readResultTurn).toBeDefined()
    expect((readResultTurn as any).content[0].type).toBe('tool_result')
    expect(h.appendMock).not.toHaveBeenCalled()
  })
})

describe('resume after approval (R6.2 / R3.2)', () => {
  it('appends a tool_result turn for the approved action and resumes — still no write', async () => {
    h.createMock.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [text('Done — Rent is funded.')] })

    const priorMessages = [
      { role: 'user', content: 'assign 100 to rent' },
      { role: 'assistant', content: [toolUse('toolu_c', 'assign_to_envelope', { envelopes: { rent: 100 } })] },
    ]

    const res = await chat(ev({
      messages: priorMessages,
      resolutions: [{ toolUseId: 'toolu_c', status: 'approved', resultText: 'Committed: assigned $100 to rent' }],
    }))

    // The route itself never writes — committing is the client's job via the
    // existing endpoint. Here we only verify the resume protocol.
    expect(h.appendMock).not.toHaveBeenCalled()
    const sentMessages = h.createMock.mock.calls[0]![0].messages
    const resumeTurn = sentMessages.find((m: any) =>
      m.role === 'user' && Array.isArray(m.content) && m.content[0]?.tool_use_id === 'toolu_c')
    expect(resumeTurn).toBeDefined()
    expect(resumeTurn.content[0].content).toContain('Committed')
    expect(res.reply).toBe('Done — Rent is funded.')
  })

  it('echoes held read results back alongside the resolution (mixed turn, R3.3)', async () => {
    h.createMock.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [text('ok')] })
    const heldRead = { type: 'tool_result', tool_use_id: 'toolu_read', content: '{"readyToAssign":250}' }

    const res = await chat(ev({
      messages: [{ role: 'assistant', content: [toolUse('toolu_act', 'assign_to_envelope', {})] }],
      readToolResults: [heldRead],
      resolutions: [{ toolUseId: 'toolu_act', status: 'rejected', resultText: 'User rejected this action' }],
    }))

    // The resume turn resolves BOTH tool_use ids together (held read + verdict).
    const turn = res.messages.find((m: any) =>
      m.role === 'user' && Array.isArray(m.content) && m.content.some((b: any) => b.tool_use_id === 'toolu_act'))
    expect(turn).toBeDefined()
    const ids = (turn as any).content.map((b: any) => b.tool_use_id).sort()
    expect(ids).toEqual(['toolu_act', 'toolu_read'])
  })
})

describe('failure & control handling', () => {
  it('returns a refusal as plain text with no actions (R4.3)', async () => {
    h.createMock.mockResolvedValueOnce({ stop_reason: 'refusal', content: [] })
    const res = await chat(ev({ message: 'do something off-limits' }))
    expect(res.proposedActions).toHaveLength(0)
    expect(res.reply.length).toBeGreaterThan(0)
  })

  it('stops at the iteration cap instead of looping forever (R4.4)', async () => {
    h.budgetMock.mockResolvedValue({})
    // Always asks for a read tool → would loop forever without the cap.
    h.createMock.mockResolvedValue({ stop_reason: 'tool_use', content: [toolUse('toolu_loop', 'get_budget', {})] })

    const res = await chat(ev({ message: 'loop' }))

    expect(h.createMock).toHaveBeenCalledTimes(8) // MAX_TOOL_ITERATIONS
    expect(res.proposedActions).toHaveLength(0)
    expect(res.reply).toMatch(/more steps/i)
    expect(h.appendMock).not.toHaveBeenCalled()
  })

  it('returns a friendly error (not a 500) when the model call fails (R4.5)', async () => {
    h.createMock.mockRejectedValueOnce(new Error('network down'))
    const res = await chat(ev({ message: 'hi' }))
    expect(res.reply).toMatch(/trouble/i)
    expect(res.proposedActions).toHaveLength(0)
  })

  it('reports a billing/credit error accurately, not as a malformed conversation', async () => {
    h.createMock.mockRejectedValueOnce(
      Object.assign(new Error('Your credit balance is too low to access the Anthropic API.'), { status: 400 }),
    )
    const res = await chat(ev({ message: 'hi' }))
    expect(res.reply).toMatch(/out of credits/i)
    expect(res.reply).not.toMatch(/snag/i)
  })

  it('maps a 401 to a key-rejected message', async () => {
    h.createMock.mockRejectedValueOnce(Object.assign(new Error('invalid x-api-key'), { status: 401 }))
    const res = await chat(ev({ message: 'hi' }))
    expect(res.reply).toMatch(/key was rejected/i)
  })

  it('returns 503 when ANTHROPIC_API_KEY is unset (R4.2)', async () => {
    h.state.keyConfigured = false
    await expect(chat(ev({ message: 'hi' }))).rejects.toMatchObject({ statusCode: 503 })
    expect(h.createMock).not.toHaveBeenCalled()
  })
})
