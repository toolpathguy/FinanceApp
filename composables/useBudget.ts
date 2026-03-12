import type { BudgetReport } from '~/types/ui'

export function useBudget(period?: MaybeRefOrGetter<string>) {
  const params = computed(() => {
    const p: Record<string, string> = {}
    const val = period ? toValue(period) : undefined
    if (val) p.period = val
    return p
  })

  return useFetch<BudgetReport>('/api/budget', {
    query: params,
    watch: [params],
  })
}
