import { spawn } from 'node:child_process'
import type { TransactionInput } from '../../types/api'

/** Resolve journal path from env, with Docker default fallback */
export function resolveJournalPath(): string {
  return process.env.LEDGER_FILE || '/data/main.journal'
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
