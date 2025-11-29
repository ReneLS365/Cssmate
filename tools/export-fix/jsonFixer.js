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

  const normalized = { ...canonical }

  normalized.version = canonical.version || '1.0'
  normalized.type = canonical.type || canonical.jobType || model?.meta?.jobType || 'montage'

  if (!normalized.jobId && model?.meta?.caseNumber) {
    normalized.jobId = model.meta.caseNumber
  }

  if (!normalized.jobName && model?.meta?.caseName) {
    normalized.jobName = model.meta.caseName
  }

  if (!normalized.createdAt && model?.meta?.createdAt) {
    normalized.createdAt = model.meta.createdAt
  }

  normalized.info = normalized.info || {}
  if (model?.meta) {
    normalized.info.sagsnummer = normalized.info.sagsnummer || model.meta.caseNumber || ''
    normalized.info.navn = normalized.info.navn || model.meta.caseName || ''
    normalized.info.adresse = normalized.info.adresse || model.meta.address || ''
    normalized.info.kunde = normalized.info.kunde || model.meta.customer || ''
    normalized.info.dato = normalized.info.dato || model.meta.date || ''
  }

  const materialsFromModel = Array.isArray(model?.items)
    ? model.items.map(item => ({
      id: item.itemNumber || item.id || '',
      name: item.name || '',
      qty: item.quantity ?? item.qty ?? 0,
      quantity: item.quantity ?? item.qty ?? 0,
      unitPrice: item.unitPrice ?? item.price ?? 0,
    }))
    : []

  if (!Array.isArray(normalized.materials) || normalized.materials.length === 0) {
    normalized.materials = materialsFromModel
  } else {
    normalized.materials = normalized.materials.map((item, index) => ({
      id: item?.id || item?.varenr || materialsFromModel[index]?.id || '',
      name: item?.name || item?.label || materialsFromModel[index]?.name || '',
      qty: item?.qty ?? item?.quantity ?? item?.antal ?? materialsFromModel[index]?.qty ?? 0,
      quantity: item?.quantity ?? item?.qty ?? item?.antal ?? materialsFromModel[index]?.quantity ?? 0,
      unitPrice: item?.unitPrice ?? item?.price ?? materialsFromModel[index]?.unitPrice ?? 0,
    })).filter(entry => entry.id || entry.name)
  }

  if (!normalized.totals && model?.totals) {
    normalized.totals = {
      materialsSum: model.totals.materials,
      laborSum: model.wage?.totals?.sum,
      extrasSum: model.totals.extras,
      akkordSum: model.totals.akkord,
      project: model.totals.project,
    }
  }

  return normalized
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
