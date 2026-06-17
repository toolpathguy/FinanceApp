import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import type { AiChatResponse, ProposedAction } from '~/types/ai'

// The composable uses auto-imported `ref` and `$fetch`.
vi.stubGlobal('ref', ref)

const fetchMock = vi.fn()
vi.stubGlobal('$fetch', (...args: any[]) => fetchMock(...args))

const { useAiChat } = await import('../useAiChat')

const assignProposal: ProposedAction = {
  id: 't1',
  kind: 'assign',
  summary: 'Assign $100.00 to Rent',
  payload: { date: '', physicalAccount: 'assets:checking', envelopes: { rent: 100 } },
}

const chatRes = (over: Partial<AiChatResponse>): AiChatResponse => ({
  messages: ['h'],
  reply: '',
  proposedActions: [],
  readToolResults: [],
  ...over,
})

beforeEach(() => {
  fetchMock.mockReset()
})

describe('useAiChat.send', () => {
  it('posts the message and records the assistant reply + proposals', async () => {
    fetchMock.mockResolvedValueOnce(chatRes({ reply: 'I can assign that.', proposedActions: [assignProposal] }))
    const chat = useAiChat()

    await chat.send('assign 100 to rent')

    expect(fetchMock).toHaveBeenCalledWith('/api/ai/chat', expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({ message: 'assign 100 to rent' }),
    }))
    expect(chat.transcript.value).toEqual([
      { role: 'user', text: 'assign 100 to rent' },
      { role: 'assistant', text: 'I can assign that.' },
    ])
    expect(chat.proposedActions.value).toHaveLength(1)
  })
})

describe('useAiChat.approve', () => {
  it('commits via the existing assign endpoint (with today\'s date), then resumes the chat', async () => {
    const onCommitted = vi.fn()
    fetchMock
      .mockResolvedValueOnce(chatRes({ reply: 'Proposing', proposedActions: [assignProposal] })) // send
      .mockResolvedValueOnce({ success: true })                                                  // commit
      .mockResolvedValueOnce(chatRes({ reply: 'Done — Rent is funded.' }))                        // resume
    const chat = useAiChat({ onCommitted })

    await chat.send('assign 100 to rent')
    await chat.approve(chat.proposedActions.value[0]!)

    // committed via the existing endpoint, with the model's payload + today's date
    const commitCall = fetchMock.mock.calls.find(c => c[0] === '/api/budget/assign')
    expect(commitCall).toBeDefined()
    expect(commitCall![1].body.physicalAccount).toBe('assets:checking')
    expect(commitCall![1].body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(onCommitted).toHaveBeenCalledOnce()

    // resumed the chat with an 'approved' resolution
    const resume = fetchMock.mock.calls.find(c => c[0] === '/api/ai/chat' && c[1].body.resolutions)
    expect(resume![1].body.resolutions[0]).toMatchObject({ toolUseId: 't1', status: 'approved' })
    expect(chat.proposedActions.value).toHaveLength(0)
    expect(chat.transcript.value.at(-1)).toEqual({ role: 'assistant', text: 'Done — Rent is funded.' })
  })

  it('does NOT mark committed when the endpoint rejects the write (R2.5)', async () => {
    fetchMock
      .mockResolvedValueOnce(chatRes({ proposedActions: [assignProposal] }))                 // send
      .mockRejectedValueOnce({ data: { message: "Can't assign $100 — only $40 left." } })    // commit fails
      .mockResolvedValueOnce(chatRes({ reply: 'Okay, that didn\'t go through.' }))            // resume
    const chat = useAiChat()

    await chat.send('assign 100 to rent')
    await chat.approve(chat.proposedActions.value[0]!)

    // Not committed: the failure is fed to the model via the resolution, and the
    // assistant explains it in the resumed reply (no separate error banner).
    const resume = fetchMock.mock.calls.find(c => c[0] === '/api/ai/chat' && c[1].body.resolutions)
    expect(resume![1].body.resolutions[0].status).toBe('rejected')
    expect(resume![1].body.resolutions[0].resultText).toContain('only $40 left')
    expect(chat.transcript.value.at(-1)).toEqual({ role: 'assistant', text: 'Okay, that didn\'t go through.' })
  })
})

describe('useAiChat.reject', () => {
  it('resumes without committing anything', async () => {
    fetchMock
      .mockResolvedValueOnce(chatRes({ proposedActions: [assignProposal] }))
      .mockResolvedValueOnce(chatRes({ reply: 'No problem.' }))
    const chat = useAiChat()

    await chat.send('assign 100 to rent')
    await chat.reject(chat.proposedActions.value[0]!)

    expect(fetchMock.mock.calls.some(c => c[0] === '/api/budget/assign')).toBe(false)
    const resume = fetchMock.mock.calls.find(c => c[0] === '/api/ai/chat' && c[1].body.resolutions)
    expect(resume![1].body.resolutions[0].status).toBe('rejected')
    expect(chat.proposedActions.value).toHaveLength(0)
  })
})

describe('useAiChat — supersede & config', () => {
  it('auto-rejects an un-acted proposal when a new message is sent (R3.4)', async () => {
    fetchMock
      .mockResolvedValueOnce(chatRes({ proposedActions: [assignProposal] })) // first send → proposal
      .mockResolvedValueOnce(chatRes({ reply: 'Sure.' }))                    // second send
    const chat = useAiChat()

    await chat.send('assign 100 to rent')
    await chat.send('actually, never mind — how much is in groceries?')

    const second = fetchMock.mock.calls[1]![1].body
    expect(second.message).toContain('groceries')
    expect(second.resolutions[0]).toMatchObject({ toolUseId: 't1', status: 'rejected' })
    expect(second.resolutions[0].resultText).toMatch(/superseded/i)
  })

  it('surfaces a not-configured state on a 503', async () => {
    fetchMock.mockRejectedValueOnce({ statusCode: 503 })
    const chat = useAiChat()
    await chat.send('hi')
    expect(chat.error.value).toBe('not-configured')
  })
})

describe('useAiChat.checkConfigured (proactive empty state, R4.2)', () => {
  it('sets not-configured when GET /api/ai/config reports no key', async () => {
    fetchMock.mockResolvedValueOnce({ configured: false })
    const chat = useAiChat()
    await chat.checkConfigured()
    expect(fetchMock).toHaveBeenCalledWith('/api/ai/config')
    expect(chat.error.value).toBe('not-configured')
  })

  it('leaves the chat usable when a key is configured', async () => {
    fetchMock.mockResolvedValueOnce({ configured: true })
    const chat = useAiChat()
    await chat.checkConfigured()
    expect(chat.error.value).toBeNull()
  })
})
