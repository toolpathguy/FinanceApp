export interface HledgerAmount {
  commodity: string
  quantity: number
}

export interface HledgerPosting {
  account: string
  amounts: HledgerAmount[]
}

export interface HledgerTransaction {
  date: string
  status: '' | '!' | '*'
  description: string
  postings: HledgerPosting[]
  index: number
}

export interface HledgerBalanceRow {
  account: string
  amounts: HledgerAmount[]
}

export interface HledgerBalanceReport {
  rows: HledgerBalanceRow[]
  totals: HledgerAmount[]
}
