<script setup lang="ts">
import type { RegisterRow } from '~/types/ui'

const props = defineProps<{ rows: RegisterRow[]; loading: boolean }>()
const emit = defineEmits<{ edit: [index: number]; delete: [index: number] }>()

const reversedRows = computed(() => [...props.rows].reverse())

const columns = [
  { accessorKey: 'date', header: 'Date' },
  { accessorKey: 'payee', header: 'Payee' },
  { accessorKey: 'category', header: 'Envelope' },
  { accessorKey: 'inflow', header: 'Inflow' },
  { accessorKey: 'outflow', header: 'Outflow' },
  { accessorKey: 'runningBalance', header: 'Balance' },
  { accessorKey: 'actions', header: '' },
]

function formatCurrency(value: number | null): string {
  if (value == null) return ''
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
</script>

<template>
  <UTable
    :data="reversedRows"
    :columns="columns"
    :loading="loading"
  >
    <template #category-cell="{ row }">
      <UTooltip
        v-if="row.original.category === 'Split'"
        :text="row.original.categoryRaw"
      >
        <span class="underline decoration-dotted cursor-help">Split</span>
      </UTooltip>
      <span v-else>{{ row.original.category }}</span>
    </template>

    <template #inflow-cell="{ row }">
      <span
        v-if="row.original.inflow != null"
        :class="row.original.isTransfer ? '' : 'text-green-500'"
      >
        {{ formatCurrency(row.original.inflow) }}
      </span>
    </template>

    <template #outflow-cell="{ row }">
      <span
        v-if="row.original.outflow != null"
        :class="row.original.isTransfer ? '' : 'text-red-500'"
      >
        {{ formatCurrency(row.original.outflow) }}
      </span>
    </template>

    <template #runningBalance-cell="{ row }">
      {{ formatCurrency(row.original.runningBalance) }}
    </template>

    <template #actions-cell="{ row }">
      <div class="flex gap-1">
        <UButton
          icon="i-lucide-pencil"
          size="xs"
          variant="ghost"
          color="neutral"
          @click="emit('edit', row.original.transactionIndex)"
        />
        <UButton
          icon="i-lucide-trash-2"
          size="xs"
          variant="ghost"
          color="error"
          @click="emit('delete', row.original.transactionIndex)"
        />
      </div>
    </template>
  </UTable>
</template>
