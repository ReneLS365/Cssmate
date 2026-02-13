import { buildAkkordData } from './akkord-data.js'
import { buildAkkordJsonPayload } from './export-json.js'
import { buildExportModel } from './export-model.js'
import { exportPDFBlob } from './export-pdf.js'
import { waitForExportReady } from './export-manager.js'

function cloneSnapshot (value) {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value))
}

function createReadinessState (data) {
  const materials = Array.isArray(data?.materials) ? data.materials : []
  const totals = data?.totals && typeof data.totals === 'object' ? data.totals : null
  const workers = Array.isArray(data?.laborTotals) ? data.laborTotals : []
  const hasHours = workers.some(worker => Number(worker?.hours) > 0)
  const calcKeys = ['materialer', 'samletAkkordsum', 'projektsum']
  const calculationsStable = calcKeys.every(key => Number.isFinite(Number(totals?.[key])))

  return {
    jobLoaded: Boolean(data?.info?.sagsnummer || data?.meta?.sagsnummer || data?.meta?.caseNumber),
    materialsLoaded: materials.length > 0,
    lonReady: hasHours,
    calculationsStable,
    materialsCount: materials.length,
    totals,
  }
}

function validateSnapshot (snapshot) {
  if (!snapshot?.job?.id) throw new Error('No job id')
  if (!Array.isArray(snapshot?.materials) || snapshot.materials.length === 0) throw new Error('No materials')
  if (!snapshot?.totals || typeof snapshot.totals !== 'object') throw new Error('No totals')
}

function buildExportSnapshot (data, model) {
  const meta = model?.meta || {}
  return cloneSnapshot({
    job: {
      id: meta.caseNumber || data?.info?.sagsnummer || data?.meta?.sagsnummer || '',
      name: meta.caseName || data?.info?.navn || '',
    },
    materials: Array.isArray(model?.items) ? model.items : [],
    lon: model?.wage || {},
    totals: model?.totals || {},
    meta,
  })
}

export async function runExport (options = {}) {
  const readData = typeof options.readData === 'function' ? options.readData : buildAkkordData

  await waitForExportReady(() => createReadinessState(readData()), options.waitOptions)

  const data = readData()
  const exportedAt = new Date().toISOString()
  const model = buildExportModel(data, { exportedAt })
  const snapshot = buildExportSnapshot(data, model)

  validateSnapshot(snapshot)

  const jsonPayload = buildAkkordJsonPayload(model, undefined, { exportedAt, rawData: data })
  const jsonBlob = new Blob([jsonPayload.content], { type: 'application/json;charset=utf-8' })
  const pdf = await exportPDFBlob(data, { model, allowPlaceholder: false })

  if (typeof window !== 'undefined') {
    const isDev = Boolean(import.meta?.env?.DEV)
    const isTest = String(import.meta?.env?.MODE || '') === 'test' || window.VITE_E2E_BYPASS_AUTH === '1'
    if (isDev || isTest) {
      console.info('[export] snapshot ready', {
        job: snapshot.job.id,
        materials: snapshot.materials.length,
      })
    }
  }

  return {
    snapshot,
    pdf,
    json: {
      blob: jsonBlob,
      fileName: jsonPayload.fileName,
      content: jsonPayload.content,
    },
  }
}
