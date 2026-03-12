import type { TransactionQuery } from '~/types/api'
import type { HledgerTransaction } from '~/types/hledger'

export function useTransactions(query?: MaybeRefOrGetter<TransactionQuery>) {
  const params = computed(() => {
    const q = query ? toValue(query) : {}
    const p: Record<string, string> = {}
    if (q.startDate) p.startDate = q.startDate
    if (q.endDate) p.endDate = q.endDate
    if (q.account) p.account = q.account
    return p
  })

  return useFetch<HledgerTransaction[]>('/api/transactions', {
    query: params,
    watch: [params],
  })
}
