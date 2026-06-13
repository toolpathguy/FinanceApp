/**
 * Validators for query parameters forwarded to the hledger CLI (Issue #2, R4 —
 * argument-injection prevention).
 *
 * No shell is involved (so not RCE), but an unvalidated value like `--debug` or
 * `-f /etc/passwd` is parsed by hledger as an *option*, changing or leaking
 * output. These pure validators constrain the charset and reject a leading `-`
 * so a value can never be read as a flag. Account query terms should ALSO be
 * passed after a `--` separator at the call site for defence in depth.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/
const PERIOD = /^[A-Za-z0-9 /-]{1,40}$/
const ACCOUNT = /^[A-Za-z0-9:_ -]{1,100}$/

/** Strict YYYY-MM-DD (used for -b / -e). */
export function isValidDate(value: string): boolean {
  return DATE.test(value)
}

/** hledger period expression: e.g. "2025-01", "this month", "2025/01-2025/02". */
export function isValidPeriod(value: string): boolean {
  return PERIOD.test(value) && !value.startsWith('-')
}

/** hledger account query term: account-name charset, never flag-like. */
export function isValidAccount(value: string): boolean {
  return ACCOUNT.test(value) && !value.startsWith('-')
}
