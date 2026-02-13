const DRAFT_KEY = 'csmate:draftJob:v1'
const LEGACY_DRAFT_KEY = 'cssmate:draftJob:v1'
const SCHEMA_VERSION = 1

function getStorage () {
  if (typeof window === 'undefined' || !window.localStorage) return null
  return window.localStorage
}

export function loadDraft () {
  const storage = getStorage()
  if (!storage) return null
  try {
    const raw = storage.getItem(DRAFT_KEY)
    const legacyRaw = raw ? null : storage.getItem(LEGACY_DRAFT_KEY)
    const sourceRaw = raw || legacyRaw
    if (!sourceRaw) return null
    const parsed = JSON.parse(sourceRaw)
    if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION || !parsed.data) {
      storage.removeItem(DRAFT_KEY)
      storage.removeItem(LEGACY_DRAFT_KEY)
      return null
    }
    if (legacyRaw) {
      storage.setItem(DRAFT_KEY, sourceRaw)
      storage.removeItem(LEGACY_DRAFT_KEY)
    }
    return parsed.data
  } catch (error) {
    storage.removeItem(DRAFT_KEY)
    storage.removeItem(LEGACY_DRAFT_KEY)
    return null
  }
}

export function saveDraft (data) {
  const storage = getStorage()
  if (!storage || !data) return
  try {
    const payload = {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: Date.now(),
      data
    }
    storage.setItem(DRAFT_KEY, JSON.stringify(payload))
  } catch (error) {
    console.warn('Kunne ikke gemme kladde', error)
  }
}

export function clearDraft () {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.removeItem(DRAFT_KEY)
    storage.removeItem(LEGACY_DRAFT_KEY)
  } catch {}
}
