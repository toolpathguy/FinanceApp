<script setup lang="ts">
const router = useRouter()

const newJournalName = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)
const selectedFile = ref<File | null>(null)

function onFileChange(event: Event) {
  const target = event.target as HTMLInputElement
  selectedFile.value = target.files?.[0] ?? null
}

function handleSave() {
  console.log('Save clicked', {
    newJournalName: newJournalName.value,
    selectedFile: selectedFile.value?.name
  })
}

function handleExport() {
  console.log('Export clicked')
}
</script>

<template>
  <UDashboardPanel id="settings">
    <template #header>
      <UDashboardNavbar title="Settings">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex justify-center p-4">
        <UCard class="w-full max-w-2xl">
          <template #body>
            <div class="flex flex-col gap-6">
              <!-- Create new journal -->
              <div class="flex flex-col gap-2">
                <h3 class="text-base font-semibold">Create new journal</h3>
                <p class="text-sm text-muted">Enter a filename for the new journal file.</p>
                <UInput
                  v-model="newJournalName"
                  placeholder="e.g. my-budget.journal"
                />
              </div>

              <USeparator />

              <!-- Upload journal -->
              <div class="flex flex-col gap-2">
                <h3 class="text-base font-semibold">Upload journal</h3>
                <p class="text-sm text-muted">Upload an existing journal file (.journal, .hledger, or .j).</p>
                <input
                  ref="fileInputRef"
                  type="file"
                  accept=".journal,.hledger,.j"
                  class="text-sm"
                  @change="onFileChange"
                />
              </div>

              <USeparator />

              <!-- Export journal -->
              <div class="flex flex-col gap-2">
                <h3 class="text-base font-semibold">Export journal</h3>
                <p class="text-sm text-muted">Download the current journal file.</p>
                <div>
                  <UButton
                    label="Export"
                    icon="i-lucide-download"
                    variant="outline"
                    @click="handleExport"
                  />
                </div>
              </div>
            </div>
          </template>

          <template #footer>
            <div class="flex items-center gap-2">
              <UButton
                label="Save"
                color="primary"
                @click="handleSave"
              />
              <UButton
                label="Esc"
                color="neutral"
                variant="ghost"
                @click="router.back()"
              />
            </div>
          </template>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
