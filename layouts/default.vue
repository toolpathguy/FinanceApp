<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import type { AccountTreeItem } from '~/types/ui'

const open = ref(false)

const route = useRoute()
const selectedAccount = computed({
  get: () => {
    const path = route.path
    if (!path.startsWith('/accounts/')) return undefined
    // Decode the account path from the URL to match tree item fullName
    const encoded = path.replace('/accounts/', '')
    return { fullName: decodeURIComponent(encoded) } as AccountTreeItem
  },
  set: () => {},
})

const { data: accounts } = useAccounts('real')

const accountTree = computed(() => {
  const tree = buildAccountTree(accounts.value ?? [])
  return titleCaseTree(tree)
})

/** Title-case labels in the account tree for clean display (Requirement 7.4) */
function titleCaseTree(items: AccountTreeItem[]): AccountTreeItem[] {
  return items.map(item => ({
    ...item,
    label: stripAccountPrefix(item.label),
    children: item.children ? titleCaseTree(item.children) : undefined,
  }))
}

const links: NavigationMenuItem[][] = [[
  { label: 'Budget', icon: 'i-lucide-target', to: '/budget' },
]]

const settingsLinks: NavigationMenuItem[][] = [[
  { label: 'Settings', icon: 'i-lucide-settings', to: '/settings' },
]]

function onAccountSelect(_e: any, item: AccountTreeItem) {
  navigateTo(`/accounts/${encodeURIComponent(item.fullName)}`)
}
</script>

<template>
  <UDashboardGroup unit="rem">
    <UDashboardSidebar
      id="default"
      v-model:open="open"
      collapsible
      resizable
      class="bg-elevated/25"
      :ui="{ footer: 'lg:border-t lg:border-default' }"
    >
      <template #header="{ collapsed }">
        <div class="flex items-center gap-2" :class="collapsed ? 'justify-center' : ''">
          <UIcon name="i-lucide-wallet" class="size-6 text-primary" />
          <span v-if="!collapsed" class="font-semibold text-sm">hledger Budget</span>
        </div>
      </template>

      <template #default="{ collapsed }">
        <UNavigationMenu
          :collapsed="collapsed"
          orientation="vertical"
          :items="links"
        />

        <USeparator />

        <div class="flex items-center justify-between px-2.5" :class="collapsed ? 'justify-center' : ''">
          <span
            v-if="!collapsed"
            class="text-xs font-medium text-muted"
          >
            Accounts
          </span>
          <UButton
            v-if="!collapsed"
            icon="i-lucide-settings-2"
            size="xs"
            variant="ghost"
            color="neutral"
            to="/accounts"
          />
        </div>

        <UTree
          v-model="selectedAccount"
          :items="accountTree"
          :get-key="(item: AccountTreeItem) => item.fullName"
          color="neutral"
          size="sm"
          @select="onAccountSelect"
        />

        <UNavigationMenu
          :collapsed="collapsed"
          orientation="vertical"
          :items="settingsLinks"
          class="mt-auto"
        />
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
