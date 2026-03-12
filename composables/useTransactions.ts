import type { TransactionQuery } from '~/types/api'
import type { HledgerTransaction } from '~/types/hledger'
import type { RegisterRow } from '~/types/ui'

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

export function useRegister(query: MaybeRefOrGetter<{ account: string }>) {
  const params = computed(() => {
    const q = toValue(query)
    return { account: q.account }
  })

  return useFetch<RegisterRow[]>('/api/transactions', {
    query: params,
    watch: [params],
  })
}
