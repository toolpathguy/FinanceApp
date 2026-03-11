import type { IncomeStatement, BalanceSheet } from '~/types/ui'

export function useIncomeStatement(period?: MaybeRefOrGetter<string>) {
  const params = computed(() => {
    const p: Record<string, string> = {}
    const val = period ? toValue(period) : undefined
    if (val) p.period = val
    return p
  })

  return useFetch<IncomeStatement>('/api/reports/income-statement', {
    query: params,
    watch: [params],
  })
}

export function useBalanceSheet() {
  return useFetch<BalanceSheet>('/api/reports/balance-sheet')
}
