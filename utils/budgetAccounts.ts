/**
 * Budget account naming utilities for envelope budgeting.
 * Provides consistent mapping between physical accounts, expense categories,
 * and budget sub-accounts.
 */

/**
 * Maps a physical account and expense category to a budget sub-account path.
 * @example toBudgetSubAccount('assets:checking', 'food:groceries') → 'assets:checking:budget:food:groceries'
 */
export function toBudgetSubAccount(physicalAccount: string, category: string): string {
  return `${physicalAccount}:budget:${category}`
}

/**
 * Returns the unallocated budget sub-account for a physical account.
 * @example toUnallocatedAccount('assets:checking') → 'assets:checking:budget:unallocated'
 */
export function toUnallocatedAccount(physicalAccount: string): string {
  return `${physicalAccount}:budget:unallocated`
}

/**
 * Returns true if the account path contains ':budget:' (is a budget sub-account).
 * @example isBudgetSubAccount('assets:checking:budget:groceries') → true
 * @example isBudgetSubAccount('assets:checking') → false
 */
export function isBudgetSubAccount(account: string): boolean {
  return account.includes(':budget:')
}

/**
 * Extracts the envelope category name from a budget sub-account path.
 * @example extractEnvelopeName('assets:checking:budget:food:groceries') → 'food:groceries'
 * @example extractEnvelopeName('assets:checking:budget:unallocated') → 'unallocated'
 */
export function extractEnvelopeName(budgetAccount: string): string {
  const marker = ':budget:'
  const idx = budgetAccount.indexOf(marker)
  if (idx === -1) return budgetAccount
  return budgetAccount.slice(idx + marker.length)
}
