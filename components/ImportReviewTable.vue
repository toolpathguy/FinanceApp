<script setup lang="ts">
import type { ImportRowState } from '~/composables/useImport'

const props = defineProps<{
  rows: ImportRowState[]
  accounts: string[]
  envelopes: string[]
  canApprove: (row: ImportRowState) => boolean
}>()

// Dropdown options. A blank envelope option is offered so an inflow can stay
// uncategorized (→ Ready to Assign); outflows can't be approved without one.
const accountItems = computed(() =>
  props.accounts.map(a => ({ label: stripAccountPrefix(a), value: a })),
)
const envelopeItems = computed(() => [
  { label: '— none —', value: '' },
  ...props.envelopes.map(e => ({ label: e, value: e })),
])

function formatCurrency(amount: number): string {
  return `$${Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <!-- Header -->
    <div class="grid grid-cols-12 gap-2 px-3 py-2 text-xs font-semibold text-muted uppercase tracking-wide border-b border-default">
      <div class="col-span-1">Import</div>
      <div class="col-span-2">Date</div>
      <div class="col-span-2">Payee</div>
      <div class="col-span-1 text-right">Amount</div>
      <div class="col-span-3">Account</div>
      <div class="col-span-3">Envelope</div>
    </div>

    <!-- Rows -->
    <div
      v-for="row in rows"
      :key="row.id"
      class="grid grid-cols-12 gap-2 px-3 py-2 items-center border-b border-default/60 hover:bg-elevated/40 transition-colors"
      :class="{ 'opacity-60': !row.approved }"
    >
      <!-- Approve + duplicate badge -->
      <div class="col-span-1 flex items-center gap-1.5">
        <UCheckbox
          v-model="row.approved"
          :disabled="!canApprove(row)"
        />
        <UTooltip v-if="row.possibleDuplicate" text="Looks like a transaction already in your ledger — review before importing.">
          <UIcon name="i-lucide-copy" class="size-3.5 text-warning" />
        </UTooltip>
      </div>

      <!-- Date -->
      <div class="col-span-2">
        <UInput v-model="row.date" size="xs" class="w-full" />
      </div>

      <!-- Payee -->
      <div class="col-span-2">
        <UInput v-model="row.payee" size="xs" class="w-full" />
      </div>

      <!-- Amount + direction -->
      <div class="col-span-1 text-right text-sm font-medium" :class="row.direction === 'inflow' ? 'text-green-500' : 'text-red-500'">
        {{ row.direction === 'inflow' ? '+' : '-' }}{{ formatCurrency(row.amount) }}
      </div>

      <!-- Account -->
      <div class="col-span-3">
        <USelect
          v-model="row.account"
          :items="accountItems"
          size="xs"
          placeholder="Select account"
          class="w-full"
        />
      </div>

      <!-- Envelope -->
      <div class="col-span-3 flex items-center gap-2">
        <USelect
          v-if="row.direction === 'outflow'"
          v-model="row.envelope"
          :items="envelopeItems"
          size="xs"
          placeholder="Select envelope"
          class="w-full"
          :color="canApprove(row) ? undefined : 'error'"
        />
        <span v-else class="text-xs text-muted">→ Ready to Assign</span>
        <UTooltip :text="row.sourceRow">
          <UIcon name="i-lucide-file-text" class="size-3.5 text-muted shrink-0" />
        </UTooltip>
      </div>
    </div>
  </div>
</template>
