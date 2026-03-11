/**
 * Formats an amount object into a human-readable currency string.
 *
 * - Positive: "$1,234.56"
 * - Negative: "-$42.00"
 * - Zero: "$0.00"
 */
export function formatAmount(amount: { commodity: string; quantity: number }): string {
  const { commodity, quantity } = amount
  const abs = Math.abs(quantity)
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const prefix = quantity < 0 ? '-' : ''
  return `${prefix}${commodity}${formatted}`
}
