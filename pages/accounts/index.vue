<script setup lang="ts">
const { data: accounts, status, refresh } = useAccounts()

const newAccountName = ref('')
const adding = ref(false)
const deleting = ref<string | null>(null)

const rows = computed(() =>
  (accounts.value ?? []).map(name => ({ name }))
)

const columns = [
  { accessorKey: 'name', header: 'Account' },
  { accessorKey: 'actions', header: '' }
]

async function addAccount() {
  const name = newAccountName.value.trim()
  if (!name) return
  adding.value = true
  try {
    const today = new Date().toISOString().slice(0, 10)
    await $fetch('/api/transactions', {
      method: 'POST',
      body: {
        date: today,
        description: `Open account ${name}`,
        status: '*',
        postings: [
          { account: name, amount: 0, commodity: '$' },
          { account: 'equity:opening-balances', amount: 0, commodity: '$' }
        ]
      }
    })
    newAccountName.value = ''
    await refresh()
  } finally {
    adding.value = false
  }
}

async function deleteAccount(name: string) {
  deleting.value = name
  try {
    const today = new Date().toISOString().slice(0, 10)
    await $fetch('/api/transactions', {
      method: 'POST',
      body: {
        date: today,
        description: `Close account ${name}`,
        status: '*',
        postings: [
          { account: name, amount: 0, commodity: '$' },
          { account: 'equity:closing-balances', amount: 0, commodity: '$' }
        ]
      }
    })
    await refresh()
  } finally {
    deleting.value = null
  }
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
              placeholder="e.g. expenses:food:coffee"
              :disabled="adding"
            />
          </UFormField>
          <UButton
            type="submit"
            label="Add"
            icon="i-lucide-plus"
            :loading="adding"
            :disabled="!newAccountName.trim()"
          />
        </form>

        <UTable
          :data="rows"
          :columns="columns"
          :loading="status === 'pending'"
        >
          <template #actions-cell="{ row }">
            <UButton
              color="error"
              variant="ghost"
              icon="i-lucide-trash-2"
              size="xs"
              :loading="deleting === row.original.name"
              @click="deleteAccount(row.original.name)"
            />
          </template>
        </UTable>
      </div>
    </template>
  </UDashboardPanel>
</template>
