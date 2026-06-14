/** A single commodity's amount, as transformed from hledger JSON. */
export interface CommodityAmount {
  commodity: string
  quantity: number
}

/**
 * Thrown when an account/row holds more than one commodity in a context that
 * only supports a single commodity. Carries the context and the commodity list
 * so callers can surface a clear message (or re-throw past a tolerant catch).
 */
export class MultiCommodityError extends Error {
  constructor(public readonly context: string, public readonly commodities: string[]) {
    super(`Multiple commodities are not supported (${context}): ${commodities.join(', ')}`)
    this.name = 'MultiCommodityError'
  }
}

/**
 * Return the lone commodity's quantity from a transformed hledger amount list.
 *
 * - 0 amounts → 0 (an empty/zero balance).
 * - exactly 1 amount → its quantity.
 * - 2+ amounts → throws {@link MultiCommodityError} naming `context`, rather
 *   than silently using the first commodity and reporting wrong numbers.
 */
export function singleQuantity(
  amounts: CommodityAmount[] | undefined,
  context: string,
): number {
  if (!amounts || amounts.length === 0) return 0
  if (amounts.length > 1) {
    throw new MultiCommodityError(context, amounts.map(a => a.commodity))
  }
  return amounts[0]!.quantity
}
