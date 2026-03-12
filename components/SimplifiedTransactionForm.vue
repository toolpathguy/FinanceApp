<script setup lang="ts">
import type { SimplifiedFormState } from '~/types/ui'
import { validateSimplifiedForm } from '~/utils/validateSimplifiedForm'
import { formStateToInput, toTransactionInput } from '~/utils/toTransactionInput'

const props = defineProps<{ accountName?: string }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [] }>()
const toast = useToast()

// Fetch accounts and categories
const { data: realAccounts } = useAccounts('real')
const { data: categoryAccounts } = useAccounts('category')

// Form state
const transferMode = ref(false)
const submitting = ref(false)
const formErrors = ref<string[]>([])

function defaultFormState(): SimplifiedFormState {
  return {
    date: new Date().toISOString().slice(0, 10),
    payee: '',
    account: props.accountName ?? '',
    category: '',
    transferAccount: '',
    inflow: '',
    outflow: '',
    status: '*',
  }
}

const form = ref<SimplifiedFormState>(defaultFormState())

// Mutual exclusivity watchers
watch(() => form.value.inflow, (val) => { if (val) form.value.outflow = '' })
watch(() => form.value.outflow, (val) => { if (val) form.value.inflow = '' })

// Reset when modal opens
watch(open, (isOpen) => {
  if (isOpen) {
    form.value = defaultFormState()
    formErrors.value = []
    transferMode.value = false
  }
})

// Clear transferAccount when switching out of transfer mode, clear category when switching in
watch(transferMode, (isTransfer) => {
  if (isTransfer) {
    form.value.category = ''
  } else {
    form.value.transferAccount = ''
  }
})

// Account options for dropdowns
const accountOptions = computed(() =>
  (realAccounts.value ?? []).map((a: string) => ({ label: a, value: a })),
)

const categoryOptions = computed(() =>
  (categoryAccounts.value ?? []).map((a: string) => ({ label: a, value: a })),
)

// Transfer account options (exclude the currently selected source account)
const transferAccountOptions = computed(() =>
  (realAccounts.value ?? [])
    .filter((a: string) => a !== form.value.account)
    .map((a: string) => ({ label: a, value: a })),
)

async function submit() {
  const errors = validateSimplifiedForm(form.value)
  if (errors.length > 0) {
    formErrors.value = errors
    return
  }
  formErrors.value = []
  submitting.value = true
  try {
    const simplified = formStateToInput(form.value)
    const txInput = toTransactionInput(simplified)
    await $fetch('/api/transactions', {
      method: 'POST',
      body: txInput,
    })
    toast.add({ title: 'Transaction added', color: 'success' })
    open.value = false
    emit('saved')
  } catch (e: any) {
    toast.add({
      title: 'Failed to save',
      description: e?.data?.statusMessage || e?.message || 'Unknown error',
      color: 'error',
    })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Add Transaction">
    <template #body>
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <div v-if="formErrors.length" class="text-sm text-red-500">
          <p v-for="err in formErrors" :key="err">{{ err }}</p>
        </div>

        <UFormField label="Date">
          <UInput v-model="form.date" type="date" required />
        </UFormField>

        <UFormField label="Account">
          <USelect
            v-model="form.account"
            :items="accountOptions"
            placeholder="Select account"
            value-key="value"
          />
        </UFormField>

        <UFormField label="Payee">
          <UInput v-model="form.payee" placeholder="Who did you pay?" />
        </UFormField>

        <!-- Transfer mode toggle -->
        <div class="flex items-center gap-2">
          <UButton
            :variant="!transferMode ? 'solid' : 'ghost'"
            size="xs"
            label="Envelope"
            @click="transferMode = false"
          />
          <UButton
            :variant="transferMode ? 'solid' : 'ghost'"
            size="xs"
            label="Transfer"
            @click="transferMode = true"
          />
        </div>

        <UFormField v-if="!transferMode" label="Envelope">
          <USelect
            v-model="form.category"
            :items="categoryOptions"
            placeholder="Select envelope"
            value-key="value"
          />
        </UFormField>

        <UFormField v-else label="Transfer To">
          <USelect
            v-model="form.transferAccount"
            :items="transferAccountOptions"
            placeholder="Select destination account"
            value-key="value"
          />
        </UFormField>

        <div class="flex gap-4">
          <UFormField label="Inflow" class="flex-1">
            <UInput v-model="form.inflow" placeholder="0.00" />
          </UFormField>
          <UFormField label="Outflow" class="flex-1">
            <UInput v-model="form.outflow" placeholder="0.00" />
          </UFormField>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <UButton
            label="Cancel"
            variant="ghost"
            color="neutral"
            @click="open = false"
          />
          <UButton
            type="submit"
            label="Save"
            :loading="submitting"
          />
        </div>
      </form>
    </template>
  </UModal>
</template>
