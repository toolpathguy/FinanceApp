/**
 * Removes the first colon-separated segment from an hledger account path
 * and title-cases the remaining segments for display.
 *
 * Examples:
 *   "expenses:groceries"       → "Groceries"
 *   "assets:bank:checking"     → "Bank: Checking"
 *   "checking"                 → "Checking"
 */
export function stripAccountPrefix(accountPath: string): string {
  const segments = accountPath.split(':')

  if (segments.length <= 1) {
    return titleCase(accountPath)
  }

  return segments
    .slice(1)
    .map(titleCase)
    .join(': ')
}

function titleCase(str: string): string {
  if (str.length === 0) return str
  return str.charAt(0).toUpperCase() + str.slice(1)
}
