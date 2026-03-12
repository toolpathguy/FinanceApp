<script setup lang="ts">
const route = useRoute()
const toast = useToast()

const accountName = computed(() => {
  const segments = route.params.path as string[]
  return decodeURIComponent(segments.join('/'))
})

const registerQuery = computed(() => ({ account: accountName.value }))
const balQuery = computed(() => ({ account: accountName.value }))

const { data: registerRows, status: regStatus, refresh: refreshReg } = useRegister(registerQuery)
const { data: balanceReport, status: balStatus, refresh: refreshBal } = useBalances(balQuery)

const accountBalance = computed(() => {
  if (!balanceReport.value) return null
  const row = balanceReport.value.rows.find((r: any) => r.account === accountName.value)
  if (row && row.amounts.length > 0) return row.amounts[0]
  if (balanceReport.value.totals.length > 0) return balanceReport.value.totals[0]
  return null
})

async function refreshAll() {
  await Promise.all([refreshReg(), refreshBal()])
}

const rows = computed(() => registerRows.value ?? [])
const loading = computed(() => regStatus.value === 'pending')

const showModal = ref(false)
const deleting = ref<number | null>(null)

function editTx(_row: any) {
  toast.add({ title: 'Edit not yet supported in simplified mode', color: 'warning' })
}

async function deleteTx(row: { transactionIndex: number }) {
  if (!confirm('Delete this transaction? This cannot be undone.')) return
  deleting.value = row.transactionIndex
  try {
    await $fetch('/api/transactions', {
      method: 'DELETE',
      query: { index: row.transactionIndex },
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
            @click="showModal = true"
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
      <AccountRegister
        :rows="rows"
        :loading="loading"
        @edit="editTx"
        @delete="deleteTx"
      />
    </template>
  </UDashboardPanel>

  <SimplifiedTransactionForm
    v-model:open="showModal"
    :account-name="accountName"
    @saved="refreshAll"
  />
</template>