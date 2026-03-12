import { readFile, writeFile } from 'node:fs/promises'

export default defineEventHandler(async (event) => {
  const { index } = getQuery(event)
  if (!index) {
    throw createError({ statusCode: 400, statusMessage: 'Transaction index is required' })
  }

  const txIndex = Number(index)
  if (isNaN(txIndex) || txIndex < 1) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid transaction index' })
  }

  const filePath = resolveJournalPath()
  const content = await readFile(filePath, 'utf-8')
  const lines = content.split(/\r?\n/)

  // Parse journal to find transaction boundaries
  // A transaction starts with a date line (YYYY-MM-DD or YYYY/MM/DD) and ends
  // when we hit a blank line or another date line or EOF
  const datePattern = /^\d{4}[-/]\d{2}[-/]\d{2}/
  let currentTxStart = -1
  let currentTxNum = 0
  let deleteStart = -1
  let deleteEnd = -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (datePattern.test(line.trimStart())) {
      currentTxNum++
      currentTxStart = i

      if (currentTxNum === txIndex) {
        deleteStart = i
        // Find the end: scan forward until blank line or next transaction or EOF
        let j = i + 1
        while (j < lines.length) {
          const nextLine = lines[j]!
          if (nextLine.trim() === '') {
            deleteEnd = j // include the blank line
            break
          }
          if (datePattern.test(nextLine.trimStart())) {
            deleteEnd = j - 1
            break
          }
          j++
        }
        if (deleteEnd === -1) {
          deleteEnd = lines.length - 1
        }
        break
      }
    }
  }

  if (deleteStart === -1) {
    throw createError({ statusCode: 404, statusMessage: 'Transaction not found' })
  }

  // Remove the transaction lines
  lines.splice(deleteStart, deleteEnd - deleteStart + 1)

  await writeFile(filePath, lines.join('\n'), 'utf-8')
  return { success: true }
})
