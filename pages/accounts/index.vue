<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

const { data: accounts, status, refresh } = useAccounts()

const newAccountName = ref('')
const addingAccount = ref(false)

const columns: TableColumn<{ name: string }>[] = [
  {
    accessorKey: 'name',
    header: 'Account'
  },
  {
    id: 'actions',
    header: ''
  }
]

const tableData = computed(() =>
  (accounts.value ?? []).map(name => ({ name }))
)

async function addAccount() {
  const name = newAccountName.value.trim()
  if (!name) return

  addingAccount.value = true
  try {
    const today = new Date().toISOString().slice(0, 10)
    await $fetch('/api/transactions', {
      method: 'POST',
      body: {
        date: today,
        description: `Opening balance for ${name}`,
        status: '*',
        postings: [
          { account: name, amount: '0', commodity: '$' },
          { account: 'equity:opening-balances', amount: '0', commodity: '$' }
        ]
      }
    })
    newAccountName.value = ''
    await refresh()
  }
  finally {
    addingAccount.value = false
  }
}

async function deleteAccount(accountName: string) {
  // Will be wired in Task 9.3
  console.log('Delete account:', accountName)
}
</script>

<template>
  <UDashboardPanel id="accounts">
    <template #header>
      <UDashboardNavbar title="Accounts">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-4 p-4">
        <form class="flex items-end gap-2" @submit.prevent="addAccount">
          <UFormField label="New account" class="flex-1">
            <UInput
              v-model="newAccountName"
              placeholder="e.g. expenses:food:dining"
              icon="i-lucide-plus"
            />
          </UFormField>
          <UButton
            type="submit"
            label="Add"
            icon="i-lucide-plus"
            :loading="addingAccount"
            :disabled="!newAccountName.trim()"
          />
        </form>

        <UTable
          :data="tableData"
          :columns="columns"
          :loading="status === 'pending'"
        >
          <template #actions-cell="{ row }">
            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              size="xs"
              @click="deleteAccount(row.original.name)"
            />
          </template>
        </UTable>
      </div>
    </template>
  </UDashboardPanel>
</template>
