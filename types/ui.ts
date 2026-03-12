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

// ─── YNAB-Style Simplified Transaction Types ────────────────────────────────

/** Transaction types from the user's perspective */
export type TransactionType = 'expense' | 'income' | 'transfer'

/** What the simplified form submits to the API */
export interface SimplifiedTransactionInput {
  date: string                    // YYYY-MM-DD
  payee: string                   // Free text — who you paid/received from
  account: string                 // Full hledger account path (e.g., "assets:checking")
  type: TransactionType
  /** For expense/income: the category (e.g., "expenses:groceries", "income:salary") */
  category?: string
  /** For transfers: the target account (e.g., "assets:savings") */
  transferAccount?: string
  /** Positive number — direction determined by type + which column user entered */
  amount: number
  commodity?: string              // Defaults to "$"
  status?: '' | '!' | '*'
}

/** Shape of the simplified add-transaction form state */
export interface SimplifiedFormState {
  date: string
  payee: string
  account: string                 // Selected from account dropdown
  category: string                // Selected from category dropdown (or empty for transfers)
  transferAccount: string         // Selected from account dropdown (for transfers)
  inflow: string                  // User-entered amount string (mutually exclusive with outflow)
  outflow: string                 // User-entered amount string (mutually exclusive with inflow)
  status: '' | '!' | '*'
}

/** A single row in the YNAB-style account register */
export interface RegisterRow {
  date: string
  payee: string                   // From transaction description
  category: string                // Derived from other posting, prefix stripped
  categoryRaw: string             // Full hledger account path of other posting
  inflow: number | null           // Positive amount entering account, or null
  outflow: number | null          // Positive amount leaving account, or null
  runningBalance: number          // Cumulative balance up to this row
  isTransfer: boolean             // True if other posting is also assets/liabilities
  transactionIndex: number        // hledger tindex for edit/delete
  status: '' | '!' | '*'
}

/** An account shown in the sidebar (real financial accounts only) */
export interface RealAccount {
  fullPath: string                // e.g., "assets:checking"
  displayName: string             // e.g., "Checking" (prefix stripped, title-cased)
  type: 'asset' | 'liability'
  balance: number
  commodity: string
}

// ─── Budget Envelope Model Types ────────────────────────────────────────────

/** A single category in the budget envelope view */
export interface BudgetCategory {
  name: string                    // Display name (e.g., "Groceries")
  accountPath: string             // Full hledger path (e.g., "expenses:groceries")
  assigned: number                // Amount budgeted to this category
  activity: number                // Amount spent (from actual transactions)
  available: number               // assigned - |activity|
}

/** A group of categories (e.g., "Bills", "Everyday") */
export interface BudgetCategoryGroup {
  name: string                    // Group display name
  categories: BudgetCategory[]
  /** Totals for the group */
  assigned: number
  activity: number
  available: number
}

/** Full budget page data */
export interface BudgetEnvelopeReport {
  period: string                  // e.g., "2025-01"
  readyToAssign: number           // Total income - total assigned
  categoryGroups: BudgetCategoryGroup[]
  totalAssigned: number
  totalActivity: number
  totalAvailable: number
}

