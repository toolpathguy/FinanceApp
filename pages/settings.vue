<script setup lang="ts">
const router = useRouter()
const toast = useToast()

const newJournalName = ref('')
const uploadedFile = ref<File | null>(null)
const saving = ref(false)
const exporting = ref(false)

const { data: journalData, refresh: refreshJournals } = useFetch('/api/journal/list')

// AI Assistant API-key config (Issue #8).
interface AiConfigStatus { configured: boolean, source: 'env' | 'config' | 'none', maskedKey: string | null, hasStoredKey: boolean }
const { data: aiConfig, refresh: refreshAiConfig } = useFetch<AiConfigStatus>('/api/ai/config')
const aiKeyInput = ref('')
const aiKeySaving = ref(false)

async function handleSaveKey() {
  const key = aiKeyInput.value.trim()
  if (!key) return
  aiKeySaving.value = true
  try {
    await $fetch('/api/ai/config', { method: 'POST', body: { apiKey: key } })
    toast.add({ title: 'API key saved', description: 'The budgeting assistant is ready to use.', color: 'success' })
    aiKeyInput.value = ''
    await refreshAiConfig()
  } catch (err: any) {
    toast.add({ title: 'Error', description: err?.data?.statusMessage || err?.message || 'Failed to save key', color: 'error' })
  } finally {
    aiKeySaving.value = false
  }
}

async function handleClearKey() {
  try {
    await $fetch('/api/ai/config', { method: 'DELETE' })
    toast.add({ title: 'API key cleared', color: 'success' })
    await refreshAiConfig()
  } catch (err: any) {
    toast.add({ title: 'Error', description: err?.data?.statusMessage || err?.message || 'Failed to clear key', color: 'error' })
  }
}

async function handleCreate() {
  let name = newJournalName.value.trim()
  if (!name) return
  if (!/\.(journal|hledger|j)$/.test(name)) {
    name += '.journal'
  }
  saving.value = true
  try {
    await $fetch('/api/journal/create', { method: 'POST', body: { filename: name } })
    toast.add({ title: 'Journal created', description: `Created ${name}`, color: 'success' })
    newJournalName.value = ''
    await refreshJournals()
  } catch (err: any) {
    toast.add({ title: 'Error', description: err?.data?.statusMessage || err?.message || 'Failed to create', color: 'error' })
  } finally {
    saving.value = false
  }
}

async function handleUpload() {
  if (!uploadedFile.value) return
  saving.value = true
  try {
    const content = await readFileContent(uploadedFile.value)
    await $fetch('/api/journal/upload', {
      method: 'POST',
      body: { content, filename: uploadedFile.value.name }
    })
    toast.add({ title: 'Journal uploaded', description: `Uploaded ${uploadedFile.value.name}`, color: 'success' })
    uploadedFile.value = null
    await refreshJournals()
  } catch (err: any) {
    toast.add({ title: 'Error', description: err?.data?.statusMessage || err?.message || 'Failed to upload', color: 'error' })
  } finally {
    saving.value = false
  }
}

async function handleExport(filePath: string) {
  exporting.value = true
  try {
    const content = await $fetch<string>('/api/journal/export', { responseType: 'text' })
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const name = filePath.split(/[/\\]/).pop() || 'journal.journal'
    a.download = name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.add({ title: 'Exported', description: `Downloaded ${name}`, color: 'success' })
  } catch (err: any) {
    toast.add({ title: 'Export failed', description: err?.data?.statusMessage || err?.message || 'Could not export', color: 'error' })
  } finally {
    exporting.value = false
  }
}

async function handleActivate(filePath: string) {
  try {
    await $fetch('/api/journal/activate', { method: 'POST', body: { filename: filePath } })
    toast.add({ title: 'Journal activated', description: `Now using ${filePath}`, color: 'success' })
    await refreshJournals()
  } catch (err: any) {
    toast.add({ title: 'Activation failed', description: err?.data?.statusMessage || err?.message || 'Could not activate', color: 'error' })
  }
}

function readFileContent(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}
</script>

<template>
  <UDashboardPanel id="settings">
    <template #header>
      <UDashboardNavbar title="Settings">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton label="Back" color="neutral" variant="ghost" icon="i-lucide-arrow-left" @click="router.back()" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex justify-center p-6">
        <div class="w-full max-w-2xl flex flex-col gap-6">

          <UCard>
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-file-plus" class="size-5" />
                <span class="font-semibold">Create new journal</span>
              </div>
            </template>
            <p class="text-sm text-muted mb-3">Enter a filename. The .journal extension will be added automatically.</p>
            <div class="flex items-end gap-2">
              <UFormField label="Filename" class="flex-1">
                <UInput v-model="newJournalName" placeholder="e.g. my-budget" />
              </UFormField>
              <UButton label="Create" icon="i-lucide-plus" :loading="saving" :disabled="!newJournalName.trim()" @click="handleCreate" />
            </div>
          </UCard>

          <UCard>
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-upload" class="size-5" />
                <span class="font-semibold">Upload journal</span>
              </div>
            </template>
            <p class="text-sm text-muted mb-3">Drag and drop or click to upload a journal file (.journal, .hledger, or .j).</p>
            <UFileUpload
              v-model="uploadedFile"
              accept=".journal,.hledger,.j"
              label="Drop your journal file here"
              description=".journal, .hledger, or .j files"
              icon="i-lucide-file-up"
              class="w-full"
            />
            <div class="mt-3">
              <UButton label="Upload" icon="i-lucide-upload" :loading="saving" :disabled="!uploadedFile" @click="handleUpload" />
            </div>
          </UCard>

          <UCard>
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-library" class="size-5" />
                <span class="font-semibold">Available journals</span>
              </div>
            </template>
            <p class="text-sm text-muted mb-3">Activate or export a journal file.</p>
            <div v-if="journalData?.files?.length" class="flex flex-col gap-2">
              <div v-for="file in journalData.files" :key="file" class="flex items-center justify-between rounded-md border border-default px-3 py-2">
                <span class="text-sm truncate flex-1">{{ file }}</span>
                <div class="flex items-center gap-2">
                  <UButton label="Export" size="xs" variant="ghost" icon="i-lucide-download" :loading="exporting" @click="handleExport(file)" />
                  <UButton v-if="file !== journalData.activeJournal" label="Activate" size="xs" variant="soft" @click="handleActivate(file)" />
                  <UBadge v-else label="Active" color="success" size="sm" />
                </div>
              </div>
            </div>
            <p v-else class="text-sm text-muted italic">No journal files found.</p>
          </UCard>

          <UCard>
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-sparkles" class="size-5" />
                <span class="font-semibold">AI Assistant</span>
              </div>
            </template>
            <p class="text-sm text-muted mb-3">
              Set your Anthropic API key to enable the budgeting assistant. It's stored locally in
              <code>config/ai-config.json</code> (gitignored) and sent only to the Anthropic API.
            </p>

            <div class="flex items-center gap-2 mb-3 text-sm">
              <template v-if="aiConfig?.configured">
                <UIcon name="i-lucide-circle-check" class="size-4 text-success" />
                <span>Configured <span class="text-muted">({{ aiConfig.maskedKey }})</span></span>
                <UBadge v-if="aiConfig.source === 'env'" label="from environment" color="neutral" variant="subtle" size="sm" />
              </template>
              <template v-else>
                <UIcon name="i-lucide-circle" class="size-4 text-muted" />
                <span class="text-muted">Not configured</span>
              </template>
            </div>

            <p v-if="aiConfig?.source === 'env'" class="text-xs text-muted mb-3">
              The <code>ANTHROPIC_API_KEY</code> environment variable is set and takes precedence over a saved key.
              <template v-if="aiConfig?.hasStoredKey">A saved key is also stored locally (dormant while the env var is set) — use Clear to remove it.</template>
            </p>

            <div class="flex items-end gap-2">
              <UFormField label="Anthropic API key" class="flex-1">
                <UInput v-model="aiKeyInput" type="password" placeholder="sk-ant-..." autocomplete="off" class="w-full" />
              </UFormField>
              <UButton label="Save" icon="i-lucide-save" :loading="aiKeySaving" :disabled="!aiKeyInput.trim()" @click="handleSaveKey" />
              <UButton
                v-if="aiConfig?.hasStoredKey"
                label="Clear"
                color="neutral"
                variant="ghost"
                icon="i-lucide-trash-2"
                @click="handleClearKey"
              />
            </div>
          </UCard>

        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
