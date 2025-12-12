const HISTORY_KEY = 'csmate:history:v1'
const SCHEMA_VERSION = 1
const MAX_ENTRIES = 50

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

export function loadHistory () {
  const state = loadState()
  return state?.data ? state.data.slice() : []
}

export function appendHistoryEntry (entry) {
  if (!entry || typeof entry !== 'object') return null
  const current = loadHistory()
  const normalized = {
    ...entry,
    id: ensureId(entry.id),
    createdAt: entry.createdAt || entry.updatedAt || Date.now(),
    source: entry.source || 'export'
  }
  const withNewest = [normalized, ...current]
    .filter(Boolean)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, MAX_ENTRIES)
  persistState(withNewest)
  return normalized
}

export function deleteHistoryEntry (id) {
  const current = loadHistory()
  const next = current.filter(entry => String(entry?.id) !== String(id))
  persistState(next)
  return next
}
