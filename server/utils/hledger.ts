import { spawn } from 'node:child_process'
import type { TransactionInput } from '../../types/api'
import { readActiveJournalPath, SAMPLE_JOURNAL } from './activeJournal'

// Re-exported so existing importers of these from hledger.ts keep working.
export { SAMPLE_JOURNAL, ACTIVE_JOURNAL_CONFIG } from './activeJournal'

/**
 * Resolve the active journal path.
 *
 * Precedence (Issue #2, R3.4): persisted config → LEDGER_FILE env → sample.
 * Reading config from disk (rather than process.env) avoids a cross-request
 * race and survives restart. A missing/corrupt config falls back silently.
 */
export function resolveJournalPath(): string {
  return readActiveJournalPath() || process.env.LEDGER_FILE || SAMPLE_JOURNAL
}

/** Default ceiling (ms) on an hledger process before we kill it and reject. */
const DEFAULT_HLEDGER_TIMEOUT_MS = 30_000

interface RunResult { code: number; stdout: string; stderr: string }

/**
 * Spawn hledger and own its full lifecycle (Issue #4 item 1).
 *
 * Resolving only on `close` (the old behavior) hangs the request forever when
 * the process can't spawn (`ENOENT` — hledger not on PATH) or dies before close.
 * Here we also reject on the `error` event and on a timeout, settling exactly
 * once via the `settled` guard so a late event/timer can't double-settle.
 *
 * stdout/stderr are collected as Buffer chunks and decoded once with
 * `Buffer.concat` (Issue #4 item 5a): `string += Buffer` coerces each chunk via
 * `toString()` and corrupts a multi-byte UTF-8 sequence split across chunks.
 */
function runHledger(args: string[], stdin?: string): Promise<RunResult> {
  // Read env per-call so the binary/timeout can be overridden at runtime (and in
  // tests). HLEDGER_BIN lets an operator pin hledger's path (e.g. in Docker).
  const bin = process.env.HLEDGER_BIN || 'hledger'
  const timeoutMs = Number(process.env.HLEDGER_TIMEOUT_MS) || DEFAULT_HLEDGER_TIMEOUT_MS

  return new Promise<RunResult>((resolve, reject) => {
    const proc = spawn(bin, args)
    const out: Buffer[] = []
    const err: Buffer[] = []
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      proc.kill()
      reject(new Error(`hledger timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    proc.stdout.on('data', (c: Buffer) => { out.push(c) })
    proc.stderr.on('data', (c: Buffer) => { err.push(c) })

    proc.on('error', (e) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(`hledger could not be started: ${e.message}`))
    })

    proc.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        code: code ?? 0,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      })
    })

    if (stdin !== undefined) {
      proc.stdin.write(stdin)
      proc.stdin.end()
    }
  })
}

/** Run an hledger command and return parsed JSON */
export async function hledgerExec(args: string[]): Promise<unknown> {
  const file = resolveJournalPath()
  const { code, stdout, stderr } = await runHledger([...args, '-f', file, '-O', 'json'])
  if (code !== 0) throw new Error(`hledger error: ${stderr}`)
  return JSON.parse(stdout)
}

/** Run an hledger command and return raw text output (for commands that don't support -O json) */
export async function hledgerExecText(args: string[]): Promise<string> {
  const file = resolveJournalPath()
  const { code, stdout, stderr } = await runHledger([...args, '-f', file])
  if (code !== 0) throw new Error(`hledger error: ${stderr}`)
  return stdout
}

/**
 * Fallback budget base when no envelope tree exists yet (fresh journal). Also
 * the historical hardcoded value, so existing journals are unaffected.
 */
export const DEFAULT_BUDGET_BASE = 'assets:checking'

/**
 * Resolve the asset account that hosts the envelope budget tree (Issue #4 item 3).
 *
 * The budget base is, by construction, the asset account that owns a `:budget:`
 * sub-tree (e.g. `assets:checking` for `assets:checking:budget:food`). We derive
 * it from the journal's own account list rather than hardcoding `assets:checking`,
 * so users whose primary account differs still get correct envelope routing and
 * budget reporting.
 *
 * Pass `allAccounts` when the caller already fetched the account list to avoid a
 * redundant hledger call. Falls back to DEFAULT_BUDGET_BASE when no budget tree
 * exists yet.
 */
export async function resolveBudgetBase(allAccounts?: string[]): Promise<string> {
  const accounts = allAccounts
    ?? (await hledgerExecText(['accounts'])).split(/\r?\n/).map(s => s.trim()).filter(Boolean)

  for (const account of accounts) {
    if (!account.startsWith('assets:')) continue
    const idx = account.indexOf(':budget:')
    if (idx !== -1) return account.slice(0, idx)
  }
  return DEFAULT_BUDGET_BASE
}

/**
 * Transform a raw hledger amount object to our HledgerAmount interface.
 *
 * Prefer the exact integer representation (`decimalMantissa` / `decimalPlaces`,
 * value = mantissa / 10**places) over `floatingPoint`, which is a lossy binary
 * double. Falls back to `floatingPoint`, then a raw numeric `aquantity`, then 0.
 */
function transformAmount(raw: any): { commodity: string; quantity: number } {
  const q = raw.aquantity
  let quantity: number
  if (q && typeof q.decimalMantissa === 'number' && typeof q.decimalPlaces === 'number') {
    quantity = q.decimalMantissa / 10 ** q.decimalPlaces
  } else if (q && typeof q.floatingPoint === 'number') {
    quantity = q.floatingPoint
  } else if (typeof q === 'number') {
    quantity = q
  } else {
    quantity = 0
  }
  return {
    commodity: raw.acommodity ?? '',
    quantity,
  }
}

/** Transform raw hledger print JSON to our HledgerTransaction[] */
export function transformTransactions(raw: any[]): any[] {
  return raw.map((t: any) => ({
    date: t.tdate ?? '',
    status: t.tstatus === 'Cleared' ? '*' : t.tstatus === 'Pending' ? '!' : '',
    description: t.tdescription ?? '',
    index: t.tindex ?? 0,
    postings: (t.tpostings ?? []).map((p: any) => ({
      account: p.paccount ?? '',
      amounts: (p.pamount ?? []).map(transformAmount),
    })),
  }))
}

/** Transform raw hledger bal JSON to our HledgerBalanceReport */
export function transformBalanceReport(raw: any): any {
  const [rawRows, rawTotals] = raw as [any[], any[]]
  return {
    rows: (rawRows ?? []).map((row: any) => ({
      account: row[0] ?? '',
      amounts: (row[3] ?? []).map(transformAmount),
    })),
    totals: (rawTotals ?? []).map(transformAmount),
  }
}

/** Add a transaction by piping input to hledger add via stdin */
export async function addTransaction(input: TransactionInput): Promise<void> {
  const file = resolveJournalPath()

  // Build stdin lines: date, description, then account/amount pairs, end postings, save, quit
  const lines: string[] = [input.date, input.description]
  for (const p of input.postings) {
    lines.push(p.account)
    if (p.amount !== undefined) {
      const c = p.commodity ?? '$'
      lines.push(`${c}${p.amount.toFixed(2)}`)
    } else {
      lines.push('')  // accept hledger's inferred amount
    }
  }
  lines.push('.', 'y', '.')  // end postings, confirm save, quit

  const { code, stderr } = await runHledger(['add', '-f', file], lines.join('\n') + '\n')
  if (code !== 0) throw new Error(`hledger add failed: ${stderr}`)
}
