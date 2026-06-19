<script setup lang="ts">
const toast = useToast()

const {
  rows, accounts, envelopes, droppedRows, fileName,
  parsing, committing, error, result,
  canApprove, parse, commit, reset,
} = useImport({
  onCommitted: () => toast.add({ title: 'Transactions imported', color: 'success' }),
})

const fileInput = ref<HTMLInputElement | null>(null)

async function onFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const text = await file.text()
  await parse(text, file.name)
  // Reset the input so re-selecting the same file fires change again.
  if (fileInput.value) fileInput.value.value = ''
}

const approvedCount = computed(() => rows.value.filter(r => r.approved && canApprove(r)).length)
</script>

<template>
  <UDashboardPanel id="import">
    <template #header>
      <UDashboardNavbar title="Import">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            v-if="rows.length"
            label="Start over"
            icon="i-lucide-rotate-ccw"
            color="neutral"
            variant="ghost"
            @click="reset"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-4 p-4">
        <!-- Data-egress notice (R8.1): persistent, always visible. -->
        <UAlert
          icon="i-lucide-info"
          color="neutral"
          variant="subtle"
          title="Sent to Anthropic"
          description="The contents of the CSV you upload are sent to the Anthropic API to extract transactions. No bank credentials are used or stored."
        />

        <!-- No API key configured (R7.2). -->
        <div v-if="error === 'not-configured'" class="flex flex-col items-center justify-center gap-3 py-12 text-center">
          <UIcon name="i-lucide-key-round" class="size-8 text-muted" />
          <p class="font-medium">AI import isn't configured</p>
          <p class="text-sm text-muted max-w-xs">
            Add your Anthropic API key in Settings to enable CSV import.
          </p>
          <UButton label="Open Settings" icon="i-lucide-settings" size="sm" color="neutral" variant="subtle" to="/settings" />
        </div>

        <template v-else>
          <!-- Upload zone (shown until proposals exist) -->
          <div v-if="!rows.length" class="flex flex-col items-center justify-center gap-3 py-10 border border-dashed border-default rounded-lg">
            <UIcon name="i-lucide-file-up" class="size-8 text-muted" />
            <p class="text-sm text-muted">Upload a bank or credit-card CSV export.</p>
            <input
              ref="fileInput"
              type="file"
              accept=".csv,text/csv"
              class="hidden"
              @change="onFileChange"
            >
            <UButton
              label="Choose CSV file"
              icon="i-lucide-upload"
              :loading="parsing"
              @click="fileInput?.click()"
            />
          </div>

          <!-- Transport/validation error -->
          <UAlert
            v-if="error && error !== 'not-configured'"
            icon="i-lucide-triangle-alert"
            color="error"
            variant="subtle"
            :description="error"
          />

          <!-- Rows the AI couldn't parse (R1.4) -->
          <UAlert
            v-if="droppedRows.length"
            icon="i-lucide-circle-alert"
            color="warning"
            variant="subtle"
            :title="`${droppedRows.length} row(s) could not be parsed and were skipped`"
            :description="droppedRows.map(d => `${d.reason}: ${d.sourceRow}`).join('\n')"
            :ui="{ description: 'whitespace-pre-wrap text-xs' }"
          />

          <!-- Commit result summary (R4.4) -->
          <UAlert
            v-if="result"
            :icon="result.failed.length ? 'i-lucide-circle-alert' : 'i-lucide-circle-check'"
            :color="result.failed.length ? 'warning' : 'success'"
            variant="subtle"
            :title="`Imported ${result.committed} transaction(s)`"
            :description="[
              result.skippedDuplicates.length ? `${result.skippedDuplicates.length} skipped as duplicates.` : '',
              result.failed.length ? `${result.failed.length} failed: ${result.failed.map(f => f.error).join('; ')}` : '',
            ].filter(Boolean).join(' ') || undefined"
          />

          <!-- Review table -->
          <template v-if="rows.length">
            <div class="flex items-center justify-between">
              <p class="text-sm text-muted">
                Reviewing <strong>{{ rows.length }}</strong> transaction(s) from
                <strong>{{ fileName }}</strong>. Edit, then approve the ones to import.
              </p>
              <UButton
                :label="`Import ${approvedCount} approved`"
                icon="i-lucide-check"
                :loading="committing"
                :disabled="approvedCount === 0"
                @click="commit"
              />
            </div>

            <ImportReviewTable
              :rows="rows"
              :accounts="accounts"
              :envelopes="envelopes"
              :can-approve="canApprove"
            />
          </template>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
