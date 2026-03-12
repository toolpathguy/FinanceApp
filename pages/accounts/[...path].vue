<script setup lang="ts">
import type { TransactionFormState } from '~/types/ui'
import type { HledgerTransaction, HledgerPosting } from '~/types/hledger'

const route = useRoute()
const toast = useToast()

const accountName = computed(() => {
  const segments = route.params.path as string[]
  return decodeURIComponent(segments.join('/'))
})

const txQuery = computed(() => ({ account: accountName.value }))
const balQuery = computed(() => ({ account: accountName.value }))

const { data: transactions, status: txStatus, refresh: refreshTx } = useTransactions(txQuery)
const { data: balanceReport, status: balStatus, refresh: refreshBal } = useBalances(balQuery)

const accountBalance = computed(() => {
  if (!balanceReport.value) return null
  const row = balanceReport.value.rows.find(r => r.account === accountName.value)
  if (row && row.amounts.length > 0) return row.amounts[0]
  if (balanceReport.value.totals.length > 0) return balanceReport.value.totals[0]
  return null
})

async function refreshAll() {
  await Promise.all([refreshTx(), refreshBal()])
}

const columns = [
  { accessorKey: 'date', header: 'Date' },
  { accessorKey: 'description', header: 'Description' },
  { accessorKey: 'postings', header: 'Postings' },
  { accessorKey: 'amount', header: 'Amount' },
  { accessorKey: 'actions', header: 'Actions' },
]

const rows = computed(() => {
  if (!transactions.value) return []
  return transactions.value.map((tx: HledgerTransaction) => {
    const matchesAccount = (p: HledgerPosting) =>
      p.account === accountName.value || p.account.startsWith(accountName.value + ':')

    const otherPostings = tx.postings
      .filter((p: HledgerPosting) => !matchesAccount(p))
      .map((p: HledgerPosting) => p.account)
      .join(', ')

    const thisPosting = tx.postings.find((p: HledgerPosting) => matchesAccount(p))
    const amount = thisPosting?.amounts?.[0]
      ? formatAmount(thisPosting.amounts[0])
      : ''
    const isNegative = thisPosting?.amounts?.[0] ? thisPosting.amounts[0].quantity < 0 : false

    return {
      date: tx.date,
      description: tx.description,
      postings: otherPostings,
      amount,
      isNegative,
      isReversal: tx.description.startsWith('Reversal:'),
      actions: '',
      _tx: tx,
    }
  })
})

const deleting = ref<number | null>(null)

async function deleteTransaction(tx: HledgerTransaction) {
  if (!confirm('Delete this transaction? This cannot be undone.')) return
  deleting.value = tx.index
  try {
    await $fetch('/api/transactions', {
      method: 'DELETE',
      query: { index: tx.index },
    })
    toast.add({ title: 'Transaction deleted', color: 'success' })
    await refreshAll()
  } catch (e: any) {
    toast.add({
      title: 'Failed to delete',
      description: e?.data?.statusMessage || e?.message || 'Unknown error',
      color: 'error',
    })
  } finally {
    deleting.value = null
  }
}

const showModal = ref(false)
const editingTx = ref<HledgerTransaction | null>(null)
const submitting = ref(false)
const formErrors = ref<string[]>([])
const dollarSign = '$'

function defaultFormState(): TransactionFormState {
  return {
    date: new Date().toISOString().slice(0, 10),
    description: '',
    postings: [
      { account: accountName.value, amount: '', commodity: dollarSign },
      { account: '', amount: '', commodity: dollarSign },
    ],
    status: '*',
  }
}

function formStateFromTx(tx: HledgerTransaction): TransactionFormState {
  return {
    date: tx.date,
    description: tx.description,
    postings: tx.postings.map((p: HledgerPosting) => ({
      account: p.account,
      amount: p.amounts[0] ? String(p.amounts[0].quantity) : '',
      commodity: p.amounts[0]?.commodity || dollarSign,
    })),
    status: tx.status,
  }
}

const form = ref<TransactionFormState>(defaultFormState())

function openAddModal() {
  editingTx.value = null
  form.value = defaultFormState()
  formErrors.value = []
  showModal.value = true
}

function openEditModal(tx: HledgerTransaction) {
  editingTx.value = tx
  form.value = formStateFromTx(tx)
  formErrors.value = []
  showModal.value = true
}

function addPosting() {
  form.value.postings.push({ account: '', amount: '', commodity: dollarSign })
}

function removePosting(index: number) {
  if (form.value.postings.length > 2) {
    form.value.postings.splice(index, 1)
  }
}

async function submitTransaction() {
  const errors = validateTransactionForm(form.value)
  if (errors.length > 0) {
    formErrors.value = errors
    return
  }
  formErrors.value = []
  submitting.value = true
  try {
    if (editingTx.value) {
      await $fetch('/api/transactions', {
        method: 'DELETE',
        query: { index: editingTx.value.index },
      })
    }
    await $fetch('/api/transactions', {
      method: 'POST',
      body: {
        date: form.value.date,
        description: form.value.description,
        postings: form.value.postings.map(p => ({
          account: p.account,
          amount: p.amount ? Number(p.amount) : undefined,
          commodity: p.commodity || dollarSign,
        })),
        status: form.value.status,
      },
    })
    toast.add({
      title: editingTx.value ? 'Transaction updated' : 'Transaction added',
      color: 'success',
    })
    showModal.value = false
    await refreshAll()
  } catch (e: any) {
    toast.add({
      title: 'Failed to save',
      description: e?.data?.statusMessage || e?.message || 'Unknown error',
      color: 'error',
    })
  } finally {
    submitting.value = false
  }
}
</script>
<template>
  <UDashboardPanel id="account-detail">
    <template #header>
      <UDashboardNavbar :title="accountName">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            label="Add Transaction"
            icon="i-lucide-plus"
            @click="openAddModal"
          />
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar>
        <template #left>
          <span class="text-sm text-muted">Balance:</span>
          <UBadge
            v-if="accountBalance"
            :label="formatAmount(accountBalance)"
            variant="subtle"
            size="lg"
          />
          <UBadge
            v-else-if="balStatus === 'pending'"
            label="Loading..."
            variant="subtle"
            size="lg"
          />
          <UBadge
            v-else
            label="$0.00"
            variant="subtle"
            size="lg"
          />
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-4 p-4">
        <UTable
          :data="rows"
          :columns="columns"
          :loading="txStatus === 'pending'"
        >
          <template #amount-cell="{ row }">
            <span :class="row.original.isNegative ? 'text-red-500' : 'text-green-500'">
              {{ row.original.amount }}
            </span>
          </template>
          <template #actions-cell="{ row }">
            <div class="flex gap-1">
              <UButton
                v-if="!row.original.isReversal"
                icon="i-lucide-pencil"
                size="xs"
                variant="ghost"
                color="neutral"
                @click="openEditModal(row.original._tx)"
              />
              <UButton
                v-if="!row.original.isReversal"
                icon="i-lucide-trash-2"
                size="xs"
                variant="ghost"
                color="error"
                :loading="deleting === row.original._tx.index"
                @click="deleteTransaction(row.original._tx)"
              />
            </div>
          </template>
        </UTable>
      </div>
    </template>
  </UDashboardPanel>

  <UModal v-model:open="showModal" :title="editingTx ? 'Edit Transaction' : 'Add Transaction'">
    <template #body>
      <form class="flex flex-col gap-4" @submit.prevent="submitTransaction">
        <div v-if="formErrors.length" class="text-sm text-red-500">
          <p v-for="err in formErrors" :key="err">{{ err }}</p>
        </div>

        <UFormField label="Date">
          <UInput v-model="form.date" type="date" required />
        </UFormField>

        <UFormField label="Description">
          <UInput v-model="form.description" placeholder="Transaction description" required />
        </UFormField>

        <div class="flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium">Postings</span>
            <UButton
              size="xs"
              variant="ghost"
              icon="i-lucide-plus"
              label="Add Posting"
              @click="addPosting"
            />
          </div>

          <div
            v-for="(posting, i) in form.postings"
            :key="i"
            class="flex items-end gap-2"
          >
            <UFormField :label="`Account ${i + 1}`" class="flex-1">
              <UInput v-model="posting.account" placeholder="e.g. expenses:food" />
            </UFormField>
            <UFormField label="Amount">
              <UInput v-model="posting.amount" placeholder="0.00" class="w-28" />
            </UFormField>
            <UButton
              v-if="form.postings.length > 2"
              icon="i-lucide-x"
              color="error"
              variant="ghost"
              size="xs"
              @click="removePosting(i)"
            />
          </div>
        </div>

        <p v-if="editingTx" class="text-xs text-muted">
          Editing creates a reversal of the original transaction and adds a new one.
        </p>

        <div class="flex justify-end gap-2 pt-2">
          <UButton
            label="Cancel"
            variant="ghost"
            color="neutral"
            @click="showModal = false"
          />
          <UButton
            type="submit"
            label="Save"
            :loading="submitting"
          />
        </div>
      </form>
    </template>
  </UModal>
</template>
