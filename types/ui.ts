/** Budget line item: account with budgeted vs actual amounts */
export interface BudgetRow {
  account: string
  budgeted: number
  actual: number
  remaining: number
  /** 0–100 percentage spent */
  percentUsed: number
}

/** Budget report returned by GET /api/budget */
export interface BudgetReport {
  rows: BudgetRow[]
  period: string
}

/** Income statement sections */
export interface IncomeStatement {
  revenues: { account: string; amounts: { commodity: string; quantity: number }[] }[]
  expenses: { account: string; amounts: { commodity: string; quantity: number }[] }[]
  net: { commodity: string; quantity: number }[]
}

/** Balance sheet sections */
export interface BalanceSheet {
  assets: { account: string; amounts: { commodity: string; quantity: number }[] }[]
  liabilities: { account: string; amounts: { commodity: string; quantity: number }[] }[]
  equity: { account: string; amounts: { commodity: string; quantity: number }[] }[]
  net: { commodity: string; quantity: number }[]
}

/** Shape of the add-transaction form state */
export interface TransactionFormState {
  date: string
  description: string
  postings: { account: string; amount: string; commodity: string }[]
  status: '' | '!' | '*'
}

/** Account tree node for UTree items */
export interface AccountTreeItem {
  label: string
  fullName: string
  icon?: string
  children?: AccountTreeItem[]
  defaultExpanded?: boolean
}
