import { readFile, writeFile, copyFile } from 'node:fs/promises'
import path from 'node:path'
import XLSX from 'xlsx'
import { normalizeJsonModel } from './jsonFixer.js'

const LEGACY_SHEET_PATTERN = /^(20(1[4-9]|2[0-4])|ark\d*|[12])$/i

async function backupFile (filePath) {
  const backupPath = `${filePath}.bak`
  try {
    await copyFile(filePath, backupPath)
    return backupPath
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    return backupPath
  }
}

function sanitizeSheetNames (workbook) {
  const keep = new Set()
  const names = workbook.SheetNames || []
  const primary = names.find(name => /akkord/i.test(name)) || names[0]
  if (primary) keep.add(primary)
  const faktor = names.find(name => /faktor/i.test(name))
  if (faktor) keep.add(faktor)

  const cleaned = names.filter(name => {
    if (keep.has(name)) return true
    return !LEGACY_SHEET_PATTERN.test(name.trim())
  })

  workbook.SheetNames = cleaned
  Object.keys(workbook.Sheets).forEach(name => {
    if (!cleaned.includes(name)) {
      delete workbook.Sheets[name]
    }
  })
}

function updateWorkbookMeta (workbook, model) {
  if (!model) return
  workbook.Props = {
    ...(workbook.Props || {}),
    Title: `Sag ${model.meta?.caseNumber || ''}`.trim(),
    Subject: model.meta?.caseName || '',
    CreatedDate: model.meta?.createdAt ? new Date(model.meta.createdAt) : new Date(),
  }
}

export function fixXlsxBuffer (buffer, options = {}) {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    sanitizeSheetNames(workbook)
    updateWorkbookMeta(workbook, options.model)
    const newBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' })
    return { status: 'fixed', buffer: newBuffer, message: options.label || 'xlsx buffer cleaned' }
  } catch (error) {
    return { status: 'error', message: `${options.label || 'xlsx'}: ${error.message}` }
  }
}

export async function fixXlsxFile (filePath, options = {}) {
  const baseName = path.basename(filePath)
  try {
    const buffer = await readFile(filePath)
    const model = options.modelPath
      ? normalizeJsonModel(JSON.parse(await readFile(options.modelPath, 'utf8')))
      : undefined
    const result = fixXlsxBuffer(buffer, { model, label: baseName })
    if (result.status === 'fixed' && result.buffer) {
      await backupFile(filePath)
      await writeFile(filePath, result.buffer)
    }
    return { status: result.status, message: result.message }
  } catch (error) {
    return { status: 'error', message: `${baseName}: ${error.message}` }
  }
}
