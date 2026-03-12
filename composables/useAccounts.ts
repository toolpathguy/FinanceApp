export function useAccounts() {
  return useFetch<string[]>('/api/accounts')
}
