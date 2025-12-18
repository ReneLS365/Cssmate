const HISTORY_KEY = 'csmate:history:v1'
const LAST_HISTORY_KEY = 'csmate:history:last'
const SCHEMA_VERSION = 1
const MAX_ENTRIES = 200
const DOUBLE_CLICK_WINDOW_MS = 3000

function getStorage () {
  if (typeof window === 'undefined' || !window.localStorage) return null
  return window.localStorage
}

function isFiniteNumber (value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function safeParse (raw, { onError } = {}) {
  try {
    return JSON.parse(raw)
  } catch (error) {
    if (typeof onError === 'function') onError(error)
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
  const parsed = safeParse(raw, { onError: () => storage.removeItem(HISTORY_KEY) })
  if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION || !Array.isArray(parsed.data)) {
    storage.removeItem(HISTORY_KEY)
    return null
  }
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

function stableStringify (value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(item => stableStringify(item)).join(',')}]`
  const entries = Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
  return `{${entries.join(',')}}`
}

function fnv1a32 (value) {
  const stringValue = stableStringify(value)
  let hash = 0x811c9dc5
  for (let index = 0; index < stringValue.length; index += 1) {
    hash ^= stringValue.charCodeAt(index)
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0
  }
  return `h${hash.toString(16).padStart(8, '0')}`
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

function sanitizeSnapshot (value) {
  if (value == null) return null
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(item => sanitizeSnapshot(item))
  const banned = new Set(['timestamp', 'exportedAt', 'createdAt', 'createdAtMs', 'updatedAt', 'updatedAtMs', 'ts'])
  const result = {}
  Object.keys(value).forEach(key => {
    if (banned.has(key)) return
    result[key] = sanitizeSnapshot(value[key])
  })
  return result
}

function buildPayloadHash (entry = {}) {
  const snapshot = entry.payload || entry.data || entry.job || null
  if (!snapshot || typeof snapshot !== 'object') return null
  const sanitized = sanitizeSnapshot(snapshot)
  return fnv1a32(sanitized)
}

function buildCaseKey (entry = {}) {
  const meta = entry.meta || entry.data?.sagsinfo || entry.payload?.job?.info || entry.payload?.info || entry.payload?.meta || {}
  const sagsnummer = normalizeKeyPart(meta.sagsnummer || meta.caseNumber)
  const navn = normalizeKeyPart(meta.navn || meta.opgave || meta.title)
  const adresse = normalizeKeyPart(meta.adresse || meta.address || meta.site)
  const kunde = normalizeKeyPart(meta.kunde || meta.customer)
  if (sagsnummer) return `case:${sagsnummer}`
  if (adresse || kunde) return `client:${stableHash([kunde, adresse].filter(Boolean).join('|'))}`
  if (navn) return `client:${stableHash([navn, adresse, kunde].filter(Boolean).join('|'))}`
  return null
}

function buildHistoryKey (entry = {}) {
  const jobIdentity = buildCaseKey(entry) || (isFiniteNumber(entry.createdAtMs) ? `time:${entry.createdAtMs}` : null)

  const summary = summarizePayload(entry)
  const payloadHash = buildPayloadHash(entry) || (summary ? stableHash(summary) : null)

  if (jobIdentity && payloadHash) return `${jobIdentity}::${payloadHash}`
  return jobIdentity || payloadHash || null
}

function normalizeEntry (entry) {
  const now = Date.now()
  const createdAtMs = isFiniteNumber(entry.createdAtMs)
    ? entry.createdAtMs
    : isFiniteNumber(entry.createdAt)
      ? Number(entry.createdAt)
      : isFiniteNumber(entry.timestamp)
        ? Number(entry.timestamp)
        : now
  const updatedAtMs = isFiniteNumber(entry.updatedAtMs)
    ? entry.updatedAtMs
    : isFiniteNumber(entry.updatedAt)
      ? Number(entry.updatedAt)
      : createdAtMs
  const tzOffsetMin = isFiniteNumber(entry.tzOffsetMin)
    ? entry.tzOffsetMin
    : new Date(createdAtMs).getTimezoneOffset()
  const timeZone = entry.timeZone || (typeof Intl !== 'undefined' && Intl.DateTimeFormat ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined)
  const normalized = {
    ...entry,
    id: ensureId(entry.id),
    createdAt: createdAtMs,
    createdAtMs,
    updatedAt: updatedAtMs,
    updatedAtMs,
    tzOffsetMin,
    timeZone,
    source: entry.source || 'export',
  }
  const caseKey = entry.caseKey || buildCaseKey(normalized) || null
  normalized.historyKey = entry.historyKey || buildHistoryKey({ ...normalized, caseKey }) || null
  normalized.caseKey = caseKey || normalized.historyKey || normalized.id
  return normalized
}

function dedupeEntries (entries = []) {
  const byKey = new Map()
  entries.filter(Boolean).forEach(raw => {
    const entry = normalizeEntry(raw)
    const key = entry.caseKey || entry.historyKey
    if (!key) return
    const existing = byKey.get(key)
    if (!existing || (entry.createdAt || 0) >= (existing.createdAt || 0)) {
      byKey.set(key, { ...existing, ...entry, id: existing?.id || entry.id, createdAt: entry.createdAt })
    }
  })
  return Array.from(byKey.values())
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, MAX_ENTRIES)
}

function loadLastAttempt () {
  const storage = getStorage()
  if (!storage) return null
  const raw = storage.getItem(LAST_HISTORY_KEY)
  if (!raw) return null
  const parsed = safeParse(raw, { onError: () => storage.removeItem(LAST_HISTORY_KEY) })
  if (!parsed || typeof parsed !== 'object') {
    storage.removeItem(LAST_HISTORY_KEY)
    return null
  }
  return parsed
}

function persistLastAttempt (historyKey, createdAt, caseKey) {
  const storage = getStorage()
  if (!storage || (!historyKey && !caseKey)) return
  const payload = { key: historyKey, caseKey, at: Date.now(), createdAt }
  const serialized = safeStringify(payload)
  if (serialized) storage.setItem(LAST_HISTORY_KEY, serialized)
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
  const now = Date.now()
  if (normalized.historyKey || normalized.caseKey) {
    const lastAttempt = loadLastAttempt()
    const matchesHistoryKey = normalized.historyKey && lastAttempt?.key === normalized.historyKey
    const matchesCaseKey = normalized.caseKey && lastAttempt?.caseKey === normalized.caseKey
    const isRecentClick = (matchesHistoryKey || matchesCaseKey)
      && (now - (lastAttempt.at || 0)) < DOUBLE_CLICK_WINDOW_MS
    const createdDelta = Math.abs((lastAttempt?.createdAt || 0) - (normalized.createdAt || 0))
    if (isRecentClick && createdDelta < DOUBLE_CLICK_WINDOW_MS) {
      const existingFast = current.find(item =>
        (matchesHistoryKey && item.historyKey === normalized.historyKey) ||
        (matchesCaseKey && item.caseKey === normalized.caseKey)
      )
      if (existingFast && (normalized.createdAt || 0) > (existingFast.createdAt || 0)) {
        const merged = dedupeEntries([normalized, ...current.filter(item => item !== existingFast)])
        persistState(merged)
        persistLastAttempt(normalized.historyKey, normalized.createdAt, normalized.caseKey)
        return merged.find(item => item.caseKey === normalized.caseKey) || merged.find(item => item.historyKey === normalized.historyKey) || normalized
      }
      return existingFast || normalized
    }
  }
  const existingIndex = current.findIndex(item =>
    (normalized.caseKey && item.caseKey === normalized.caseKey) ||
    (normalized.historyKey && item.historyKey === normalized.historyKey)
  )
  if (existingIndex >= 0) {
    const existing = current[existingIndex]
    if ((normalized.createdAt || 0) > (existing.createdAt || 0)) {
      current[existingIndex] = { ...existing, ...normalized, createdAt: normalized.createdAt }
      const deduped = dedupeEntries(current)
      persistState(deduped)
    }
    persistLastAttempt(normalized.historyKey, normalized.createdAt, normalized.caseKey)
    return current.find(item => item.caseKey === normalized.caseKey) || current.find(item => item.historyKey === normalized.historyKey) || normalized
  }

  const merged = dedupeEntries([normalized, ...current])
  persistState(merged)
  persistLastAttempt(normalized.historyKey, normalized.createdAt, normalized.caseKey)
  return merged.find(item => item.caseKey === normalized.caseKey) || merged.find(item => item.historyKey === normalized.historyKey) || normalized
}

export function deleteHistoryEntry (id) {
  const current = loadHistory()
  const next = current.filter(entry => String(entry?.id) !== String(id))
  persistState(next)
  return next
}
