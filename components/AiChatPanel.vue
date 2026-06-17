<script setup lang="ts">
const emit = defineEmits<{ committed: [] }>()

const { transcript, proposedActions, pending, error, send, approve, reject, checkConfigured } = useAiChat({
  onCommitted: () => emit('committed'),
})

// Show the not-configured empty state proactively, before the first message.
onMounted(checkConfigured)

const input = ref('')
const promptStatus = computed<'ready' | 'submitted'>(() => (pending.value ? 'submitted' : 'ready'))

function onSubmit() {
  const text = input.value.trim()
  if (!text) return
  input.value = ''
  send(text)
}
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Data-egress notice (R5.1): persistent, always visible. -->
    <UAlert
      icon="i-lucide-info"
      color="neutral"
      variant="subtle"
      title="Sent to Anthropic"
      description="Your messages and budget data are sent to the Anthropic API to generate replies."
      class="m-3 mb-0"
    />

    <!-- No API key configured (R4.2): show guidance instead of a broken chat. -->
    <div v-if="error === 'not-configured'" class="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
      <UIcon name="i-lucide-key-round" class="size-8 text-muted" />
      <p class="font-medium">AI chat isn't configured</p>
      <p class="text-sm text-muted max-w-xs">
        Add your Anthropic API key in Settings to enable the budgeting assistant.
      </p>
      <UButton label="Open Settings" icon="i-lucide-settings" size="sm" color="neutral" variant="subtle" to="/settings" />
    </div>

    <template v-else>
      <!-- Transcript -->
      <div class="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        <div v-if="transcript.length === 0" class="text-sm text-muted text-center py-8">
          Ask about your budget, or ask me to assign or move money — I'll propose it for you to approve.
        </div>

        <div
          v-for="(msg, i) in transcript"
          :key="i"
          class="flex"
          :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
        >
          <div
            class="rounded-lg px-3 py-2 text-sm max-w-[85%] whitespace-pre-wrap"
            :class="msg.role === 'user' ? 'bg-primary text-inverted' : 'bg-elevated'"
          >
            {{ msg.text }}
          </div>
        </div>

        <!-- Proposed actions awaiting approval (HITL) -->
        <UCard
          v-for="action in proposedActions"
          :key="action.id"
          variant="subtle"
          :ui="{ body: 'p-3 sm:p-3' }"
        >
          <div class="flex items-start gap-2">
            <UIcon name="i-lucide-wand-sparkles" class="size-4 mt-0.5 text-primary shrink-0" />
            <div class="flex-1">
              <p class="text-xs font-semibold uppercase tracking-wide text-muted">
                {{ action.kind === 'assign' ? 'Proposed assignment' : 'Proposed transfer' }}
              </p>
              <p class="text-sm mt-0.5">{{ action.summary }}</p>
              <div class="flex gap-2 mt-2">
                <UButton
                  label="Approve"
                  icon="i-lucide-check"
                  color="primary"
                  size="xs"
                  :disabled="pending"
                  @click="approve(action)"
                />
                <UButton
                  label="Reject"
                  icon="i-lucide-x"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :disabled="pending"
                  @click="reject(action)"
                />
              </div>
            </div>
          </div>
        </UCard>

        <!-- Transport/runtime error (R4.5) -->
        <UAlert
          v-if="error && error !== 'not-configured'"
          icon="i-lucide-triangle-alert"
          color="error"
          variant="subtle"
          :description="error"
        />
      </div>

      <!-- Input -->
      <div class="p-3 border-t border-default">
        <UChatPrompt
          v-model="input"
          variant="subtle"
          placeholder="Ask about your budget…"
          :disabled="pending"
          @submit="onSubmit"
        >
          <UChatPromptSubmit :status="promptStatus" color="primary" />
        </UChatPrompt>
      </div>
    </template>
  </div>
</template>
