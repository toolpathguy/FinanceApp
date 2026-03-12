/**
 * Filters hledger account paths into real accounts (assets/liabilities)
 * and category accounts (expenses/income).
 *
 * Both functions preserve the original order of the input array.
 */

/**
 * Returns only accounts starting with `assets:` or `liabilities:`.
 * Preserves original order.
 */
export function filterRealAccounts(accounts: string[]): string[] {
  return accounts.filter(a => a.startsWith('assets:') || a.startsWith('liabilities:'))
}

/**
 * Returns only accounts starting with `expenses:` or `income:`.
 * Preserves original order.
 */
export function filterCategoryAccounts(accounts: string[]): string[] {
  return accounts.filter(a => a.startsWith('expenses:') || a.startsWith('income:'))
}
