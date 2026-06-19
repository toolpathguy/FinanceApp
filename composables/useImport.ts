import { ref } from 'vue'
import type {
  ImportProposal, ImportParseResponse, CommitRow, ImportCommitResponse, DroppedRow,
} from '~/types/import'

/**
 * A proposal row with the user's editable selections + approval state for the
 * table. `account`/`envelope` are initialized from the model's suggestions and
 * edited in place; `date`/`payee`/`amount` (from ImportProposal) are editable too.
 */
export interface ImportRowState extends ImportProposal {
  approved: boolean
  account: string
  envelope: string
}

function is503(e: unknown): boolean {
  const err = e as any
  return err?.statusCode === 503 || err?.status === 503 || err?.response?.status === 503
}

function errMessage(e: unknown): string {
  const err = e as any
  return err?.data?.message || err?.data?.statusMessage || err?.statusMessage || err?.message || 'Something went wrong.'
}

/**
 * Client for AI-assisted CSV import (Issue #9). Thin layer over
 * `/api/import/parse` and `/api/import/commit` — no business logic, no
 * accounting math. Holds the editable proposal rows and the commit result.
 *
 * @param options.onCommitted called after a commit that wrote ≥1 row, so the
 *   page can refresh balances/budget.
 */
export function useImport(options?: { onCommitted?: () => void }) {
  const rows = ref<ImportRowState[]>([])
  const accounts = ref<string[]>([])
  const envelopes = ref<string[]>([])
  const droppedRows = ref<DroppedRow[]>([])
  const fileName = ref('')
  const parsing = ref(false)
  const committing = ref(false)
  /** 'not-configured' (no API key) | a message | null. */
  const error = ref<string | null>(null)
  const result = ref<ImportCommitResponse | null>(null)

  /** An outflow must have an envelope before it can be approved (R3.3). */
  function canApprove(row: ImportRowState): boolean {
    return row.direction === 'inflow' || !!row.envelope
  }

  async function parse(csvText: string, name: string): Promise<void> {
    if (parsing.value || !csvText.trim()) return
    parsing.value = true
    error.value = null
    result.value = null
    fileName.value = name
    try {
      const res = await $fetch<ImportParseResponse>('/api/import/parse', {
        method: 'POST',
        body: { csv: csvText },
      })
      accounts.value = res.context.accounts
      envelopes.value = res.context.envelopes
      droppedRows.value = res.droppedRows
      // Pre-approve confident, non-duplicate rows; leave duplicates and
      // unapprovable rows (outflow w/o envelope) for the user to decide.
      rows.value = res.proposals.map((p): ImportRowState => ({
        ...p,
        approved: !p.possibleDuplicate && (p.direction === 'inflow' || !!p.suggestedEnvelope),
        account: p.suggestedAccount,
        envelope: p.suggestedEnvelope,
      }))
    } catch (e) {
      error.value = is503(e) ? 'not-configured' : errMessage(e)
      rows.value = []
    } finally {
      parsing.value = false
    }
  }

  async function commit(): Promise<void> {
    if (committing.value) return
    const approved = rows.value.filter(r => r.approved && canApprove(r))
    if (!approved.length) {
      error.value = 'Approve at least one row before importing.'
      return
    }
    committing.value = true
    error.value = null
    try {
      const body: CommitRow[] = approved.map(r => ({
        date: r.date, payee: r.payee, amount: r.amount, direction: r.direction,
        account: r.account, envelope: r.envelope, dedupHash: r.dedupHash,
      }))
      result.value = await $fetch<ImportCommitResponse>('/api/import/commit', {
        method: 'POST',
        body: { rows: body },
      })
      if (result.value.committed > 0) options?.onCommitted?.()
    } catch (e) {
      error.value = errMessage(e)
    } finally {
      committing.value = false
    }
  }

  function reset(): void {
    rows.value = []
    accounts.value = []
    envelopes.value = []
    droppedRows.value = []
    fileName.value = ''
    error.value = null
    result.value = null
  }

  return {
    rows, accounts, envelopes, droppedRows, fileName,
    parsing, committing, error, result,
    canApprove, parse, commit, reset,
  }
}
