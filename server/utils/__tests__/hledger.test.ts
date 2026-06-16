import { describe, it, expect, afterEach } from 'vitest'
import fc from 'fast-check'
import { resolveJournalPath, hledgerExec, hledgerExecText, resolveBudgetBase, DEFAULT_BUDGET_BASE, transformTransactions, transformBalanceReport } from '../hledger'
import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Property 3: Path resolution returns a non-empty string
 * For any environment configuration, resolveJournalPath() returns a non-empty string
 * matching the expected value.
 *
 * Validates: Requirements 1.1, 1.2, 1.3
 */
describe('resolveJournalPath', () => {
  const originalEnv = process.env.LEDGER_FILE

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.LEDGER_FILE = originalEnv
    } else {
      delete process.env.LEDGER_FILE
    }
  })

  it('Property 3: returns LEDGER_FILE value when set to any non-empty string', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
        (path) => {
          process.env.LEDGER_FILE = path
          const result = resolveJournalPath()
          expect(result).toBe(path)
          expect(result.length).toBeGreaterThan(0)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('Property 3: returns default path when LEDGER_FILE is not set', () => {
    delete process.env.LEDGER_FILE
    const result = resolveJournalPath()
    expect(result).toBe('test-data/sample.journal')
    expect(result.length).toBeGreaterThan(0)
  })

  it('Property 3: always returns a non-empty string for any env configuration', () => {
    fc.assert(
      fc.property(
        fc.option(fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0), { nil: undefined }),
        (envValue) => {
          if (envValue !== undefined) {
            process.env.LEDGER_FILE = envValue
          } else {
            delete process.env.LEDGER_FILE
          }
          const result = resolveJournalPath()
          expect(typeof result).toBe('string')
          expect(result.length).toBeGreaterThan(0)
        }
      ),
      { numRuns: 100 }
    )
  })
})

/**
 * transformAmount (exercised via transformTransactions / transformBalanceReport)
 * must prefer the exact decimalMantissa/decimalPlaces representation.
 */
describe('amount transform precision', () => {
  it('derives quantity from decimalMantissa / decimalPlaces', () => {
    const raw = [{
      tdate: '2025-01-01',
      tdescription: 'Test',
      tindex: 1,
      tpostings: [{
        paccount: 'assets:checking',
        pamount: [{ acommodity: '$', aquantity: { decimalMantissa: 350000, decimalPlaces: 2, floatingPoint: 3500 } }],
      }],
    }]
    const [tx] = transformTransactions(raw)
    expect(tx.postings[0].amounts[0]).toEqual({ commodity: '$', quantity: 3500 })
  })

  it('falls back to floatingPoint when mantissa is absent', () => {
    const report = transformBalanceReport([
      [['assets:checking', 'checking', 0, [{ acommodity: '$', aquantity: { floatingPoint: 12.34 } }]]],
      [],
    ])
    expect(report.rows[0].amounts[0].quantity).toBeCloseTo(12.34, 2)
  })

  it('uses mantissa for values where floatingPoint would lose precision', () => {
    // 9999999.99 — exact via cents, lossy as a parsed double in some paths.
    const report = transformBalanceReport([
      [['assets:big', 'big', 0, [{ acommodity: '$', aquantity: { decimalMantissa: 999999999, decimalPlaces: 2, floatingPoint: 9999999.99 } }]]],
      [],
    ])
    expect(report.rows[0].amounts[0].quantity).toBe(9999999.99)
  })
})

/**
 * Issue #4 item 1: hledger process never hangs the request.
 * A spawn failure (ENOENT) must REJECT, not leave the promise unsettled.
 * We force the failure deterministically via HLEDGER_BIN → a missing binary,
 * so this runs regardless of whether real hledger is installed.
 */
describe('runHledger process lifecycle (Issue #4 item 1)', () => {
  const originalBin = process.env.HLEDGER_BIN
  const originalTimeout = process.env.HLEDGER_TIMEOUT_MS

  afterEach(() => {
    if (originalBin !== undefined) process.env.HLEDGER_BIN = originalBin
    else delete process.env.HLEDGER_BIN
    if (originalTimeout !== undefined) process.env.HLEDGER_TIMEOUT_MS = originalTimeout
    else delete process.env.HLEDGER_TIMEOUT_MS
  })

  it('R1.1: rejects (does not hang) when the binary cannot be spawned', async () => {
    process.env.HLEDGER_BIN = 'hledger-does-not-exist-xyzzy'
    await expect(hledgerExec(['print'])).rejects.toThrow(/could not be started/)
  })

  it('R1.1: hledgerExecText also rejects on spawn failure', async () => {
    process.env.HLEDGER_BIN = 'hledger-does-not-exist-xyzzy'
    await expect(hledgerExecText(['accounts'])).rejects.toThrow(/could not be started/)
  })

  it('R1.2: kills and rejects with a timeout error when the process runs too long', async () => {
    if (!hledgerAvailable) return // needs a real process that takes >1ms to run
    process.env.HLEDGER_TIMEOUT_MS = '1'
    await expect(hledgerExec(['print'])).rejects.toThrow(/timed out/)
  })
})

/**
 * Issue #4 item 5a: stdout must not be accumulated via `string += Buffer`,
 * which corrupts multi-byte UTF-8 sequences split across chunk boundaries.
 */
describe('buffer-safe output (Issue #4 item 5a)', () => {
  const sourceCode = fs.readFileSync(path.join(__dirname, '..', 'hledger.ts'), 'utf-8')

  it('no `stdout +=` / `+= c` chunk concatenation remains', () => {
    expect(sourceCode).not.toMatch(/stdout\s*\+=/)
    expect(sourceCode).not.toMatch(/stderr\s*\+=/)
    expect(sourceCode).toContain('Buffer.concat')
  })
})

/**
 * Issue #4 item 3: derive the budget base from the journal rather than
 * hardcoding `assets:checking`. Passing an explicit account list keeps these
 * cases pure (no hledger spawn).
 */
describe('resolveBudgetBase (Issue #4 item 3)', () => {
  it('returns DEFAULT_BUDGET_BASE when no asset account hosts a budget tree', async () => {
    expect(await resolveBudgetBase([])).toBe(DEFAULT_BUDGET_BASE)
    expect(await resolveBudgetBase(['assets:checking', 'expenses:food', 'income:salary']))
      .toBe(DEFAULT_BUDGET_BASE)
  })

  it('derives the base for the default checking account', async () => {
    expect(await resolveBudgetBase([
      'assets:checking',
      'assets:checking:budget:food',
      'assets:checking:budget:unallocated',
    ])).toBe('assets:checking')
  })

  it('derives a non-default base from the budget sub-tree host', async () => {
    expect(await resolveBudgetBase([
      'assets:bank:everyday',
      'assets:bank:everyday:budget:rent',
      'liabilities:credit-card',
    ])).toBe('assets:bank:everyday')
  })

  it('ignores non-asset accounts that happen to contain :budget:', async () => {
    expect(await resolveBudgetBase([
      'expenses:budget:weird',
      'assets:savings:budget:vacation',
    ])).toBe('assets:savings')
  })
})

/**
 * Check if hledger CLI is available in the environment.
 */
function checkHledgerAvailable(): boolean {
  try {
    const { execSync } = require('node:child_process')
    execSync('hledger --version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const hledgerAvailable = checkHledgerAvailable()

/**
 * Property 4: hledger is the sole journal writer
 * The app does not directly write to the journal file — only hledger add modifies it.
 * This is a static analysis property: we read the source code and verify it contains
 * no direct file write operations.
 *
 * Validates: Requirements 3.4
 */
describe('hledger is the sole journal writer', () => {
  const sourceCode = fs.readFileSync(
    path.join(__dirname, '..', 'hledger.ts'),
    'utf-8'
  )

  it('Property 4: server/utils/hledger.ts does not contain direct file write operations', () => {
    const forbiddenPatterns = [
      'writeFileSync',
      'appendFileSync',
      'writeFile(',
      'appendFile(',
      'createWriteStream',
    ]
    for (const pattern of forbiddenPatterns) {
      expect(sourceCode).not.toContain(pattern)
    }
  })

  it('Property 4: for any file path, the module only delegates writes to hledger', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
        (_arbitraryPath) => {
          // Regardless of what journal path might be configured,
          // the source code itself must not contain direct file write calls
          const forbiddenApis = [
            'fs.writeFile',
            'fs.appendFile',
            'fs.writeFileSync',
            'fs.appendFileSync',
            'createWriteStream',
          ]
          for (const api of forbiddenApis) {
            expect(sourceCode).not.toContain(api)
          }

          // The module must only import spawn from child_process for process creation
          expect(sourceCode).toContain("import { spawn } from 'node:child_process'")

          // The module must NOT import fs
          expect(sourceCode).not.toMatch(/import.*from ['"](?:node:)?fs['"]/)
        }
      ),
      { numRuns: 100 }
    )
  })
})
