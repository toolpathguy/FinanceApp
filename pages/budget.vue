<script setup lang="ts">
import type { BudgetCategory } from '~/types/ui'

const toast = useToast()

const currentPeriod = ref(new Date().toISOString().slice(0, 7))
const { data: budget, status, refresh } = useBudget(currentPeriod)

// Group management state
const showAddGroup = ref(false)
const newGroupName = ref('')
const addingGroup = ref(false)

// Envelope management state (per-group)
const showAddEnvelope = ref(false)
const addEnvelopeGroup = ref('')
const newEnvelopeName = ref('')
const addingEnvelope = ref(false)

const deletingCategory = ref<string | null>(null)

// Collapsible group state — all expanded by default
const expandedGroups = ref<Set<string>>(new Set())

watch(budget, (b) => {
  if (b?.categoryGroups) {
    for (const g of b.categoryGroups) {
      expandedGroups.value.add(g.name)
    }
  }
}, { immediate: true })

function toggleGroup(name: string) {
  if (expandedGroups.value.has(name)) {
    expandedGroups.value.delete(name)
  } else {
    expandedGroups.value.add(name)
  }
}

function formatCurrency(amount: number): string {
  const abs = Math.abs(amount)
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const prefix = amount < 0 ? '-' : ''
  return `${prefix}$${formatted}`
}

function availableColor(amount: number): string {
  if (amount > 0) return 'text-green-500'
  if (amount < 0) return 'text-red-500'
  return 'text-muted'
}

function activityColor(amount: number): string {
  if (amount < 0) return 'text-red-500'
  if (amount > 0) return 'text-green-500'
  return 'text-muted'
}

/** Strip the group prefix from an envelope name for display under its group */
function shortName(cat: BudgetCategory, groupName: string): string {
  const prefix = groupName.toLowerCase() + ': '
  if (cat.name.toLowerCase().startsWith(prefix)) {
    return cat.name.slice(prefix.length)
  }
  return cat.name
}

function openAddEnvelope(groupName: string) {
  addEnvelopeGroup.value = groupName
  newEnvelopeName.value = ''
  showAddEnvelope.value = true
}

async function createGroup() {
  const name = newGroupName.value.trim().toLowerCase()
  if (!name) return
  addingGroup.value = true
  try {
    await $fetch('/api/categories', {
      method: 'POST',
      body: { action: 'create', name },
    })
    toast.add({ title: `Group "${name}" created`, color: 'success' })
    newGroupName.value = ''
    showAddGroup.value = false
    await refresh()
  } catch (e: any) {
    toast.add({
      title: 'Failed to create group',
      description: e?.data?.statusMessage || e?.message || 'Unknown error',
      color: 'error',
    })
  } finally {
    addingGroup.value = false
  }
}

async function createEnvelope() {
  const name = newEnvelopeName.value.trim().toLowerCase()
  const group = addEnvelopeGroup.value.toLowerCase()
  if (!name || !group) return
  addingEnvelope.value = true
  try {
    await $fetch('/api/categories', {
      method: 'POST',
      body: { action: 'create', name: `${group}:${name}` },
    })
    toast.add({ title: `Envelope "${name}" created in ${addEnvelopeGroup.value}`, color: 'success' })
    newEnvelopeName.value = ''
    showAddEnvelope.value = false
    await refresh()
  } catch (e: any) {
    toast.add({
      title: 'Failed to create envelope',
      description: e?.data?.statusMessage || e?.message || 'Unknown error',
      color: 'error',
    })
  } finally {
    addingEnvelope.value = false
  }
}

async function hideEnvelope(cat: BudgetCategory) {
  if (!confirm(`Hide envelope "${cat.name}"? You can unhide it later.`)) return
  deletingCategory.value = cat.accountPath
  try {
    await $fetch('/api/hidden-envelopes', {
      method: 'POST',
      body: { action: 'hide', accountPath: cat.accountPath },
    })
    toast.add({ title: `Envelope hidden`, color: 'success' })
    await refresh()
  } catch (e: any) {
    toast.add({
      title: 'Failed to hide envelope',
      description: e?.data?.statusMessage || e?.message || 'Unknown error',
      color: 'error',
    })
  } finally {
    deletingCategory.value = null
  }
}
</script>

<template>
  <UDashboardPanel id="budget">
    <template #header>
      <UDashboardNavbar title="Budget">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UInput v-model="currentPeriod" type="month" class="w-40" />
          <UButton label="Add Group" icon="i-lucide-plus" @click="showAddGroup = true" />
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar v-if="budget">
        <template #left>
          <div class="flex items-center gap-3">
            <span class="text-sm font-medium">Ready to Assign</span>
            <UBadge
              :label="formatCurrency(budget.readyToAssign)"
              :color="budget.readyToAssign >= 0 ? 'success' : 'error'"
              variant="subtle"
              size="lg"
            />
          </div>
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-2 p-4">
        <div v-if="status === 'pending'" class="flex items-center justify-center py-12">
          <span class="text-muted">Loading budget...</span>
        </div>

        <div v-else-if="!budget || budget.categoryGroups.length === 0" class="flex flex-col items-center justify-center py-12 gap-4">
          <p class="text-muted">No envelopes found. Create a group to get started.</p>
          <UButton label="Add Group" icon="i-lucide-plus" @click="showAddGroup = true" />
        </div>

        <div v-else class="flex flex-col gap-1">
          <!-- Table header -->
          <div class="grid grid-cols-12 gap-2 px-3 py-2 text-xs font-semibold text-muted uppercase tracking-wide border-b border-default">
            <div class="col-span-5">Envelope</div>
            <div class="col-span-2 text-right">Assigned</div>
            <div class="col-span-2 text-right">Activity</div>
            <div class="col-span-2 text-right">Available</div>
            <div class="col-span-1"></div>
          </div>

          <!-- Groups -->
          <div v-for="group in budget.categoryGroups" :key="group.name" class="border-b border-default">
            <!-- Group header -->
            <div class="grid grid-cols-12 gap-2 w-full px-3 py-2.5 hover:bg-elevated/50 transition-colors items-center">
              <div class="col-span-5 flex items-center gap-2 font-semibold text-sm">
                <button class="flex items-center gap-2 cursor-pointer" @click="toggleGroup(group.name)">
                  <UIcon
                    :name="expandedGroups.has(group.name) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                    class="w-4 h-4 text-muted"
                  />
                  {{ group.name }}
                </button>
                <UButton
                  icon="i-lucide-plus"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  @click.stop="openAddEnvelope(group.name)"
                />
              </div>
              <div class="col-span-2 text-right text-sm font-medium">{{ formatCurrency(group.assigned) }}</div>
              <div class="col-span-2 text-right text-sm font-medium" :class="activityColor(group.activity)">{{ formatCurrency(group.activity) }}</div>
              <div class="col-span-2 text-right text-sm font-medium" :class="availableColor(group.available)">{{ formatCurrency(group.available) }}</div>
              <div class="col-span-1"></div>
            </div>

            <!-- Envelope rows -->
            <template v-if="expandedGroups.has(group.name)">
              <div
                v-for="cat in group.categories"
                :key="cat.accountPath"
                class="grid grid-cols-12 gap-2 px-3 py-2 hover:bg-elevated/50 transition-colors items-center"
              >
                <div class="col-span-5 pl-8 text-sm">{{ shortName(cat, group.name) }}</div>
                <div class="col-span-2 text-right text-sm">{{ formatCurrency(cat.assigned) }}</div>
                <div class="col-span-2 text-right text-sm" :class="activityColor(cat.activity)">{{ formatCurrency(cat.activity) }}</div>
                <div class="col-span-2 text-right text-sm font-medium" :class="availableColor(cat.available)">{{ formatCurrency(cat.available) }}</div>
                <div class="col-span-1 flex justify-end">
                  <UButton
                    icon="i-lucide-eye-off"
                    size="xs"
                    variant="ghost"
                    color="neutral"
                    :loading="deletingCategory === cat.accountPath"
                    @click="hideEnvelope(cat)"
                  />
                </div>
              </div>
            </template>
          </div>

          <!-- Overall totals -->
          <div class="grid grid-cols-12 gap-2 px-3 py-3 font-semibold text-sm border-t-2 border-default bg-elevated/30">
            <div class="col-span-5">Total</div>
            <div class="col-span-2 text-right">{{ formatCurrency(budget.totalAssigned) }}</div>
            <div class="col-span-2 text-right" :class="activityColor(budget.totalActivity)">{{ formatCurrency(budget.totalActivity) }}</div>
            <div class="col-span-2 text-right" :class="availableColor(budget.totalAvailable)">{{ formatCurrency(budget.totalAvailable) }}</div>
            <div class="col-span-1"></div>
          </div>
        </div>
      </div>
    </template>
  </UDashboardPanel>

  <!-- Add Group Modal -->
  <UModal v-model:open="showAddGroup" title="Add Group">
    <template #body>
      <form class="flex flex-col gap-4" @submit.prevent="createGroup">
        <UFormField label="Group Name">
          <UInput v-model="newGroupName" placeholder="e.g. bills, savings, everyday" autofocus />
        </UFormField>
        <p class="text-xs text-muted">
          This will create: <strong>expenses:{{ newGroupName.trim().toLowerCase() || '...' }}</strong>
        </p>
        <div class="flex justify-end gap-2 pt-2">
          <UButton label="Cancel" variant="ghost" color="neutral" @click="showAddGroup = false" />
          <UButton type="submit" label="Create" :loading="addingGroup" :disabled="!newGroupName.trim()" />
        </div>
      </form>
    </template>
  </UModal>

  <!-- Add Envelope Modal (per-group) -->
  <UModal v-model:open="showAddEnvelope" :title="`Add Envelope to ${addEnvelopeGroup}`">
    <template #body>
      <form class="flex flex-col gap-4" @submit.prevent="createEnvelope">
        <UFormField label="Envelope Name">
          <UInput v-model="newEnvelopeName" placeholder="e.g. rent, groceries, electric" autofocus />
        </UFormField>
        <p class="text-xs text-muted">
          This will create: <strong>expenses:{{ addEnvelopeGroup.toLowerCase() }}:{{ newEnvelopeName.trim().toLowerCase() || '...' }}</strong>
        </p>
        <div class="flex justify-end gap-2 pt-2">
          <UButton label="Cancel" variant="ghost" color="neutral" @click="showAddEnvelope = false" />
          <UButton type="submit" label="Create" :loading="addingEnvelope" :disabled="!newEnvelopeName.trim()" />
        </div>
      </form>
    </template>
  </UModal>
</template>
