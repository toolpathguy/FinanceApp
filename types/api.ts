import type { HledgerAmount } from './hledger'

export interface PostingInput {
  account: string
  amount?: number
  commodity?: string // defaults to "$"
  balanceAssertion?: number
}

export interface TransactionInput {
  date: string // YYYY-MM-DD
  description: string
  postings: PostingInput[]
  status?: '' | '!' | '*'
}

export interface BalanceQuery {
  period?: string
  account?: string
  depth?: number
}

export interface TransactionQuery {
  startDate?: string
  endDate?: string
  account?: string
}
