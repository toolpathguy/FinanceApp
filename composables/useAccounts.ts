export function useAccounts(type?: 'real' | 'category' | 'all') {
  const query = computed(() => type ? { type } : {})
  return useFetch<string[]>('/api/accounts', { query })
}
