import type {
  AiChatRequest,
  AiChatResponse,
  ProposedAction,
  ChatResolution,
  ChatDisplayMessage,
} from '~/types/ai'

function is503(e: unknown): boolean {
  const err = e as any
  return err?.statusCode === 503 || err?.status === 503 || err?.response?.status === 503
}

function errMessage(e: unknown): string {
  const err = e as any
  return err?.data?.message || err?.data?.statusMessage || err?.statusMessage || err?.message || 'Unknown error'
}

/**
 * Client for the AI budgeting chat (Issue #8). Thin data-fetch layer over
 * `/api/ai/chat` plus the existing assign/transfer endpoints — no business logic.
 *
 * Holds the opaque Anthropic history (`messages`) and any held read-tool results,
 * and round-trips them so the server stays stateless. Money is committed ONLY
 * here, on explicit user approval, via the existing endpoints; the chat route
 * never writes.
 *
 * @param options.onCommitted called after a successful assign/transfer commit so
 *   the page can refresh the budget view.
 */
export function useAiChat(options?: { onCommitted?: () => void }) {
  const transcript = ref<ChatDisplayMessage[]>([])
  const proposedActions = ref<ProposedAction[]>([]) // still-undecided proposals
  const pending = ref(false)
  /** 'not-configured' (no API key) | a message | null. */
  const error = ref<string | null>(null)

  // Opaque round-trip state (never rendered raw).
  const history = ref<unknown[]>([])
  const heldReadResults = ref<unknown[]>([])
  // Verdicts accumulated while a multi-proposal turn is being decided.
  const decided = ref<ChatResolution[]>([])

  /**
   * Probe key configuration so the panel shows the not-configured empty state
   * proactively (R4.2) — before the user types and hits a 503. Call on mount.
   */
  async function checkConfigured(): Promise<void> {
    try {
      const cfg = await $fetch<{ configured: boolean }>('/api/ai/config')
      error.value = cfg.configured ? null : 'not-configured'
    } catch {
      // A transient failure here shouldn't block the UI; the first send will
      // surface any real problem.
    }
  }

  async function run(req: AiChatRequest): Promise<void> {
    error.value = null
    try {
      const res = await $fetch<AiChatResponse>('/api/ai/chat', { method: 'POST', body: req })
      history.value = res.messages
      heldReadResults.value = res.readToolResults
      proposedActions.value = res.proposedActions
      if (res.reply) transcript.value.push({ role: 'assistant', text: res.reply })
    } catch (e) {
      error.value = is503(e)
        ? 'not-configured'
        : 'Sorry — I had trouble reaching the assistant. Please try again.'
    }
  }

  /** Resume the loop once every proposal in the turn has a verdict. */
  async function maybeResume(): Promise<void> {
    if (proposedActions.value.length > 0) return // still awaiting other verdicts
    const resolutions = decided.value
    const held = heldReadResults.value
    decided.value = []
    heldReadResults.value = []
    await run({ messages: history.value, resolutions, readToolResults: held })
  }

  function record(action: ProposedAction, status: ChatResolution['status'], resultText: string): void {
    decided.value.push({ toolUseId: action.id, status, resultText })
    proposedActions.value = proposedActions.value.filter(a => a.id !== action.id)
  }

  async function send(text: string): Promise<void> {
    if (pending.value || !text.trim()) return
    pending.value = true
    try {
      // R3.4: a new message auto-rejects any un-acted proposals so there's no
      // dangling tool_use; combine with any already-decided verdicts.
      const supersede: ChatResolution[] = proposedActions.value.map(a => ({
        toolUseId: a.id,
        status: 'rejected',
        resultText: 'Superseded by a new message',
      }))
      const resolutions = [...decided.value, ...supersede]
      const held = heldReadResults.value
      decided.value = []
      proposedActions.value = []
      heldReadResults.value = []
      transcript.value.push({ role: 'user', text })
      await run({
        messages: history.value,
        message: text,
        resolutions: resolutions.length ? resolutions : undefined,
        readToolResults: held.length ? held : undefined,
      })
    } finally {
      pending.value = false
    }
  }

  async function approve(action: ProposedAction): Promise<void> {
    if (pending.value) return
    pending.value = true
    try {
      const today = new Date().toISOString().slice(0, 10)
      try {
        if (action.kind === 'assign') {
          await $fetch('/api/budget/assign', { method: 'POST', body: { ...action.payload, date: today } })
        } else {
          await $fetch('/api/budget/transfer', { method: 'POST', body: { ...action.payload, date: today } })
        }
        options?.onCommitted?.()
        record(action, 'approved', `Committed: ${action.summary}`)
      } catch (e) {
        // R2.5: the endpoint rejected the write (e.g. availability gate). Don't
        // mark it committed; feed the failure to the model via the resolution so
        // the assistant explains it in its reply (rather than a redundant banner).
        record(action, 'rejected', `Could not apply that: ${errMessage(e)}`)
      }
      await maybeResume()
    } finally {
      pending.value = false
    }
  }

  async function reject(action: ProposedAction): Promise<void> {
    if (pending.value) return
    pending.value = true
    try {
      record(action, 'rejected', 'User rejected this action')
      await maybeResume()
    } finally {
      pending.value = false
    }
  }

  return { transcript, proposedActions, pending, error, send, approve, reject, checkConfigured }
}
