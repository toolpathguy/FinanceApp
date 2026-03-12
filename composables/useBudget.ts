import type { BudgetEnvelopeReport } from '~/types/ui'

export function useBudget(period?: MaybeRefOrGetter<string>) {
  const query = computed(() => {
    const p = period ? toValue(period) : ''
    return p ? { period: p } : {}
  })

  return useFetch<BudgetEnvelopeReport>('/api/budget', { query, watch: [query] })
}
