const HISTORY_KEY = 'csmate:history:v1'
const SCHEMA_VERSION = 1
const MAX_ENTRIES = 200

function getStorage () {
  if (typeof window === 'undefined' || !window.localStorage) return null
  return window.localStorage
}

function safeParse (raw) {
  try {
    return JSON.parse(raw)
  } catch (error) {
    console.warn('Kunne ikke parse historik', error)
    return null
  }
}

function safeStringify (value) {
  try {
    return JSON.stringify(value)
  } catch (error) {
    console.warn('Kunne ikke serialisere historik', error)
    return null
  }
}

function loadState () {
  const storage = getStorage()
  if (!storage) return null
  const raw = storage.getItem(HISTORY_KEY)
  if (!raw) return null
  const parsed = safeParse(raw)
  if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION || !Array.isArray(parsed.data)) return null
  return parsed
}

function persistState (entries) {
  const storage = getStorage()
  if (!storage) return
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: Date.now(),
    data: entries
  }
  const serialized = safeStringify(payload)
  if (!serialized) return
  try {
    storage.setItem(HISTORY_KEY, serialized)
  } catch (error) {
    console.warn('Kunne ikke gemme historik', error)
  }
}

function ensureId (value) {
  if (value) return String(value)
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function normalizeKeyPart (value) {
  return (value || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function stableHash (input) {
  const value = (input || '').toString()
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index)
    hash |= 0
  }
  return `h${Math.abs(hash)}`
}

function summarizePayload (entry = {}) {
  const payload = entry.payload || entry.data || entry.job || {}
  const info = payload.info || payload.meta || payload.sagsinfo || {}
  const materials = Array.isArray(payload.materials) ? payload.materials.slice(0, 10) : []
  const labor = Array.isArray(payload.labor)
    ? payload.labor
    : Array.isArray(payload.wage?.workers)
      ? payload.wage.workers
      : []

  const summary = {
    info: {
      navn: normalizeKeyPart(info.navn || info.opgave || info.title || ''),
      adresse: normalizeKeyPart(info.adresse || info.address || info.site || ''),
      kunde: normalizeKeyPart(info.kunde || info.customer || ''),
    },
    materials: materials.map(item => [normalizeKeyPart(item.id || item.name), Number(item.quantity || item.qty || 0)]),
    labor: labor.map(item => [normalizeKeyPart(item.name || item.navn || item.montor || item.montoer), Number(item.rate || item.sats || item.hourlyWithAllowances || 0)]),
  }
  const hasContent = summary.info.navn || summary.info.adresse || summary.info.kunde || summary.materials.length || summary.labor.length
  if (!hasContent) return null
  return safeStringify(summary) || null
}

function buildHistoryKey (entry = {}) {
  const meta = entry.meta || entry.data?.sagsinfo || entry.payload?.job?.info || entry.payload?.info || entry.payload?.meta || {}
  const sagsnummer = normalizeKeyPart(meta.sagsnummer || meta.caseNumber)
  if (sagsnummer) return `case:${sagsnummer}`

  const navn = normalizeKeyPart(meta.navn || meta.opgave || meta.title)
  const adresse = normalizeKeyPart(meta.adresse || meta.address || meta.site)
  const kunde = normalizeKeyPart(meta.kunde || meta.customer)
  const joined = [navn, adresse, kunde].filter(Boolean).join('|')
  if (joined) return `case:${stableHash(joined)}`

  const summary = summarizePayload(entry)
  if (summary) return `case:${stableHash(summary)}`

  return null
}

function normalizeEntry (entry) {
  const createdAt = entry.createdAt || entry.updatedAt || Date.now()
  const normalized = {
    ...entry,
    id: ensureId(entry.id),
    createdAt,
    updatedAt: entry.updatedAt || createdAt,
    source: entry.source || 'export',
  }
  normalized.caseKey = entry.caseKey || buildHistoryKey(normalized) || normalized.id
  return normalized
}

function dedupeEntries (entries = []) {
  const byKey = new Map()
  entries.filter(Boolean).forEach(raw => {
    const entry = normalizeEntry(raw)
    const existing = byKey.get(entry.caseKey)
    if (!existing || (entry.createdAt || 0) >= (existing.createdAt || 0)) {
      byKey.set(entry.caseKey, { ...existing, ...entry, id: existing?.id || entry.id, createdAt: entry.createdAt })
    }
  })
  return Array.from(byKey.values())
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, MAX_ENTRIES)
}

export { buildHistoryKey }

export function migrateHistory () {
  const state = loadState()
  if (!state?.data) return []
  const deduped = dedupeEntries(state.data)
  const changed = state.data.length !== deduped.length
    || state.data.some((entry, index) => entry.caseKey !== deduped[index]?.caseKey)
  if (changed) {
    persistState(deduped)
  }
  return deduped
}

export function loadHistory () {
  const state = loadState()
  const rawEntries = state?.data || []
  const entries = rawEntries.length ? dedupeEntries(rawEntries) : []
  const changed = rawEntries.length !== entries.length
    || rawEntries.some((entry, index) => entry.caseKey !== entries[index]?.caseKey)
  if (state?.data && changed) {
    persistState(entries)
  }
  return entries.slice()
}

export function appendHistoryEntry (entry) {
  if (!entry || typeof entry !== 'object') return null
  const normalized = normalizeEntry(entry)
  const current = loadHistory()
  const merged = dedupeEntries([normalized, ...current])
  persistState(merged)
  return merged.find(item => item.caseKey === normalized.caseKey) || normalized
}

export function deleteHistoryEntry (id) {
  const current = loadHistory()
  const next = current.filter(entry => String(entry?.id) !== String(id))
  persistState(next)
  return next
}
