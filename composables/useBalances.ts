import type { BalanceQuery } from '~/types/api'
import type { HledgerBalanceReport } from '~/types/hledger'

export function useBalances(query?: MaybeRefOrGetter<BalanceQuery>) {
  const params = computed(() => {
    const q = query ? toValue(query) : {}
    const p: Record<string, string> = {}
    if (q.period) p.period = q.period
    if (q.account) p.account = q.account
    if (q.depth != null) p.depth = String(q.depth)
    return p
  })

  return useFetch<HledgerBalanceReport>('/api/balances', {
    query: params,
    watch: [params],
  })
}
