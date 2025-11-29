import { readFile, writeFile, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { buildExportModel } from '../../js/export-model.js'

function clone (value) {
  return JSON.parse(JSON.stringify(value))
}

function applyCanonicalKeys (data) {
  const normalized = clone(data)

  if (normalized && typeof normalized === 'object') {
    normalized.totals = normalized.totals || {}
    if (normalized.totals.slaebeBelob && !normalized.totals.slaebBelob) {
      normalized.totals.slaebBelob = normalized.totals.slaebeBelob
      delete normalized.totals.slaebeBelob
    }

    if (normalized.totals.slaebebelob && !normalized.totals.slaebBelob) {
      normalized.totals.slaebBelob = normalized.totals.slaebebelob
      delete normalized.totals.slaebebelob
    }

    if (normalized.tralleLoeft && !normalized.tralleState) {
      normalized.tralleState = normalized.tralleLoeft
    }

    if (normalized.tralleState && normalized.tralle) {
      normalized.tralleState = { ...normalized.tralleState, ...normalized.tralle }
      delete normalized.tralle
    }

    if (normalized.akkord && typeof normalized.akkord === 'object') {
      const akkord = normalized.akkord
      if (akkord.slaebeBelob && !akkord.slaebBelob) {
        akkord.slaebBelob = akkord.slaebeBelob
        delete akkord.slaebeBelob
      }
      if (akkord.tralleState && !normalized.tralleState) {
        normalized.tralleState = akkord.tralleState
      }
    }
  }

  return normalized
}

export function normalizeJsonModel (raw) {
  const canonical = applyCanonicalKeys(raw)
  const model = buildExportModel(canonical)
  return model
}

async function backupFile (filePath) {
  const backupPath = `${filePath}.bak`
  try {
    await copyFile(filePath, backupPath)
    return backupPath
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error
    }
    return backupPath
  }
}

export async function fixJsonFile (filePath) {
  try {
    const original = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(original)
    const model = normalizeJsonModel(parsed)
    const newContent = `${JSON.stringify(model, null, 2)}\n`
    const status = newContent === `${original.endsWith('\n') ? original : `${original}\n`}` ? 'ok' : 'fixed'
    if (status === 'fixed') {
      await backupFile(filePath)
      await writeFile(filePath, newContent, 'utf8')
    }
    return { status, message: path.basename(filePath) }
  } catch (error) {
    return { status: 'error', message: `${path.basename(filePath)}: ${error.message}` }
  }
}
