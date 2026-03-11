import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import fc from 'fast-check'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

// --- Temp file for round-trip testing ---
const tempFilePath = join(tmpdir(), `journal-roundtrip-${randomUUID()}.journal`)

// --- Mock Nitro globals ---
const mockReadBody = vi.fn()
const mockSetResponseHeader = vi.fn()

vi.stubGlobal('defineEventHandler', (handler: Function) => handler)
vi.stubGlobal('readBody', mockReadBody)
vi.stubGlobal('createError', (opts: { statusCode: number; statusMessage?: string; message?: string }) => {
  const err = new Error(opts.statusMessage || opts.message) as any
  err.statusCode = opts.statusCode
  return err
})
vi.stubGlobal('setResponseHeader', mockSetResponseHeader)

// --- Mock resolveJournalPath to use our temp file ---
vi.mock('../../utils/hledger', () => ({
  resolveJournalPath: () => tempFilePath,
}))

// Import handlers after globals and mocks are set up
const { default: uploadHandler } = await import('../journal/upload.post')
const { default: exportHandler } = await import('../journal/export.get')

const fakeEvent = {} as any

beforeEach(() => {
  vi.clearAllMocks()
})

afterAll(async () => {
  try {
    await unlink(tempFilePath)
  } catch {
    // file may not exist if tests didn't write it
  }
})


/**
 * Arbitrary: generates non-empty journal-like string content.
 * Uses printable ASCII lines joined by newlines to simulate realistic journal text.
 */
const journalLineArb = fc.stringMatching(/^[ -~]{0,200}$/)

const journalContentArb = fc
  .array(journalLineArb, { minLength: 1, maxLength: 20 })
  .map((lines) => lines.join('\n'))
  .filter((s) => s.trim().length > 0)

describe('Journal upload/export round-trip — Property Tests', () => {
  /**
   * Property 7: Journal upload/export round-trip
   *
   * For any valid journal file content, uploading it via POST /api/journal/upload
   * and then exporting via GET /api/journal/export shall return content identical
   * to the original upload.
   *
   * **Validates: Requirements 9.2, 9.3**
   */
  it('Property 7: uploaded content is identical when exported', async () => {
    await fc.assert(
      fc.asyncProperty(journalContentArb, async (content) => {
        // Upload: mock readBody to return the content (no filename → uses resolveJournalPath)
        mockReadBody.mockResolvedValue({ content })

        const uploadResult = await uploadHandler(fakeEvent)
        expect(uploadResult).toEqual({ success: true })

        // Export: read back the file
        const exported = await exportHandler(fakeEvent)

        // Round-trip: exported content must match uploaded content exactly
        expect(exported).toBe(content)

        // Verify setResponseHeader was called with text/plain
        expect(mockSetResponseHeader).toHaveBeenCalledWith(fakeEvent, 'Content-Type', 'text/plain')
      }),
      { numRuns: 50 },
    )
  })
})
