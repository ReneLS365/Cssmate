const STORAGE_KEY = 'sscaff:org_id'

function readStorage () {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage || null
  } catch {
    return null
  }
}

export function getSavedOrgId () {
  const storage = readStorage()
  if (!storage) return ''
  try {
    return storage.getItem(STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

export function saveOrgId (orgId) {
  const storage = readStorage()
  if (!storage) return
  if (!orgId) return
  try {
    storage.setItem(STORAGE_KEY, String(orgId))
  } catch {
    // ignore storage failures
  }
}

export function clearSavedOrgId () {
  const storage = readStorage()
  if (!storage) return
  try {
    storage.removeItem(STORAGE_KEY)
  } catch {
    // ignore storage failures
  }
}

export function installOrgDebugHooks () {
  if (typeof window === 'undefined') return
  const root = window.__sscaffAuth || {}
  if (typeof root.clearOrg !== 'function') {
    root.clearOrg = () => {
      clearSavedOrgId()
      console.info('[auth] cleared org')
    }
  }
  window.__sscaffAuth = root
}
