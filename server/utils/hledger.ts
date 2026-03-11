import { spawn } from 'node:child_process'
import type { TransactionInput } from '../../types/api'

/** Resolve journal path from env, with Docker default fallback */
export function resolveJournalPath(): string {
  return process.env.LEDGER_FILE || 'test-data/sample.journal'
}

/** Run an hledger command and return parsed JSON */
export async function hledgerExec(args: string[]): Promise<unknown> {
  const file = resolveJournalPath()
  const fullArgs = [...args, '-f', file, '-O', 'json']
  const proc = spawn('hledger', fullArgs)

  let stdout = '', stderr = ''
  proc.stdout.on('data', (c) => { stdout += c })
  proc.stderr.on('data', (c) => { stderr += c })

  const code = await new Promise<number>((res) => proc.on('close', res))
  if (code !== 0) throw new Error(`hledger error: ${stderr}`)
  return JSON.parse(stdout)
}

/** Run an hledger command and return raw text output (for commands that don't support -O json) */
export async function hledgerExecText(args: string[]): Promise<string> {
  const file = resolveJournalPath()
  const fullArgs = [...args, '-f', file]
  const proc = spawn('hledger', fullArgs)

  let stdout = '', stderr = ''
  proc.stdout.on('data', (c) => { stdout += c })
  proc.stderr.on('data', (c) => { stderr += c })

  const code = await new Promise<number>((res) => proc.on('close', res))
  if (code !== 0) throw new Error(`hledger error: ${stderr}`)
  return stdout
}

/** Transform a raw hledger amount object to our HledgerAmount interface */
function transformAmount(raw: any): { commodity: string; quantity: number } {
  return {
    commodity: raw.acommodity ?? '',
    quantity: raw.aquantity?.floatingPoint ?? raw.aquantity ?? 0,
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
  const proc = spawn('hledger', ['add', '-f', file])

  let stderr = ''
  proc.stderr.on('data', (c) => { stderr += c })

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

  proc.stdin.write(lines.join('\n') + '\n')
  proc.stdin.end()

  const code = await new Promise<number>((res) => proc.on('close', res))
  if (code !== 0) throw new Error(`hledger add failed: ${stderr}`)
}
