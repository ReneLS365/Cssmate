import { getAuthDiagnostics, initSharedAuth, loginWithProvider } from '../../js/shared-auth.js'
import {
  getFirebaseConfigSnapshot,
  getFirebaseConfigSource,
  getFirebaseConfigStatus,
  getFirebaseConfigSummarySnapshot,
  getFirebaseEnvPresence,
} from '../config/firebase-config.js'
import { maskFirebaseApiKey } from '../config/firebase-utils.js'
import { markCacheReset } from '../state/debug.js'

const PANEL_ID = 'authDiagnosticsPanel'

export function isDiagnosticsEnabled() {
  try {
    if (typeof window === 'undefined') return false
    const params = new URLSearchParams(window.location.search)
    if (
      params.get('diag') === '1' ||
      params.get('debug') === '1' ||
      window.location.pathname.startsWith('/diag') ||
      window.location.pathname.startsWith('/_diag')
    ) {
      return true
    }
  } catch (_) {}
  return false
}

function formatBoolean(value) {
  return value ? 'true' : 'false'
}

function safeString(value) {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function maskString(value) {
  if (!value) return value
  let masked = value
  const apiKeyPrefix = 'A' + 'I' + 'z' + 'a'
  const apiKeyRegex = new RegExp(`${apiKeyPrefix}[0-9A-Za-z-_]{10,}`, 'g')
  masked = masked.replace(apiKeyRegex, match => maskFirebaseApiKey(match))
  masked = masked.replace(/(apiKey[=:\s"']+)([A-Za-z0-9-_]{20,})/gi, (_, prefix, key) => {
    return `${prefix}${maskFirebaseApiKey(key)}`
  })
  return masked
}

function sanitizeValue(value) {
  if (typeof value === 'string') return maskString(value)
  if (Array.isArray(value)) return value.map(entry => sanitizeValue(entry))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitizeValue(entry)]))
  }
  return value
}

function sanitizeError(error) {
  if (!error || typeof error !== 'object') return null
  const sanitized = {
    code: error.code || '',
    message: error.message || '',
    customData: error.customData || null,
    stack: error.stack || '',
  }
  return sanitizeValue(sanitized)
}

function createRow(label, value) {
  const row = document.createElement('li')
  row.className = 'auth-diagnostics-panel__row'
  row.dataset.label = label
  const labelEl = document.createElement('span')
  labelEl.className = 'auth-diagnostics-panel__label'
  labelEl.textContent = label
  const valueEl = document.createElement('span')
  valueEl.className = 'auth-diagnostics-panel__value'
  valueEl.textContent = value
  row.append(labelEl, valueEl)
  return row
}

function createPanel() {
  const panel = document.createElement('section')
  panel.id = PANEL_ID
  panel.className = 'auth-diagnostics-panel'
  panel.setAttribute('aria-live', 'polite')

  const header = document.createElement('header')
  header.className = 'auth-diagnostics-panel__header'
  const title = document.createElement('h2')
  title.textContent = 'Auth diagnostics'
  const subtitle = document.createElement('p')
  subtitle.className = 'auth-diagnostics-panel__hint'
  subtitle.textContent = 'Aktiv ved ?diag=1, ?debug=1, /diag eller /_diag.'
  header.append(title, subtitle)

  const list = document.createElement('ul')
  list.className = 'auth-diagnostics-panel__list'

  const banner = document.createElement('p')
  banner.className = 'auth-diagnostics-panel__banner'
  banner.hidden = true
  banner.textContent = 'Firebase API key missing or invalid.'

  const actions = document.createElement('div')
  actions.className = 'auth-diagnostics-panel__actions'

  const resetButton = document.createElement('button')
  resetButton.type = 'button'
  resetButton.textContent = 'Reset SW + caches'

  const signInButton = document.createElement('button')
  signInButton.type = 'button'
  signInButton.textContent = 'Run sign-in test'
  signInButton.dataset.role = 'primary'

  actions.append(resetButton, signInButton)

  const output = document.createElement('pre')
  output.className = 'auth-diagnostics-panel__output'
  output.textContent = 'Ingen auth-test kørt endnu.'

  panel.append(header, banner, list, actions, output)
  panel.listEl = list
  panel.outputEl = output
  panel.resetButton = resetButton
  panel.signInButton = signInButton
  panel.bannerEl = banner
  return panel
}

async function countCacheEntries() {
  if (typeof caches === 'undefined' || typeof caches.keys !== 'function') return null
  try {
    const cacheKeys = await caches.keys()
    let total = 0
    for (const cacheKey of cacheKeys) {
      const cache = await caches.open(cacheKey)
      const entries = await cache.keys()
      total += entries.length
    }
    return total
  } catch (error) {
    console.warn('Cache optælling fejlede', error)
    return null
  }
}

async function updateCacheEntryRow(panel) {
  const list = panel?.listEl
  if (!list) return
  const row = list.querySelector('li[data-label="Cache entries"]')
  if (!row) return
  const valueEl = row.querySelector('.auth-diagnostics-panel__value')
  if (!valueEl) return
  const total = await countCacheEntries()
  valueEl.textContent = typeof total === 'number' ? String(total) : '–'
}

function renderPanel(panel) {
  const list = panel?.listEl
  if (!list) return
  list.textContent = ''

  const auth = getAuthDiagnostics()
  const configSummary = getFirebaseConfigSummarySnapshot()
  const configSnapshot = getFirebaseConfigSnapshot() || {}
  const configStatus = getFirebaseConfigStatus()
  const envPresence = getFirebaseEnvPresence()
  const buildMeta = (typeof window !== 'undefined' ? window.CSSMATE_BUILD_META : null) || {}
  const controller = typeof navigator !== 'undefined' ? navigator.serviceWorker?.controller : null
  const apiKey = typeof configSnapshot.apiKey === 'string' ? configSnapshot.apiKey.trim() : ''
  const apiKeyMissing = (configStatus.missingKeys || []).includes('VITE_FIREBASE_API_KEY')
  const apiKeyPlaceholder = (configStatus.placeholderKeys || []).includes('VITE_FIREBASE_API_KEY')
  const apiKeyInvalid = apiKeyMissing || apiKeyPlaceholder
  const apiKeyMasked = apiKey.length >= 12 ? maskFirebaseApiKey(apiKey) : ''
  const summaryApiKeyMasked = !apiKeyInvalid ? (configSummary.apiKeyMasked || '') : ''
  const apiKeyValue = summaryApiKeyMasked || apiKeyMasked || '(missing)'

  const rows = [
    ['Origin', safeString(typeof window !== 'undefined' ? window.location.origin : '')],
    ['Path', safeString(typeof window !== 'undefined' ? window.location.pathname : '')],
    ['Build ID', safeString(buildMeta.buildId || buildMeta.appVersion || window.CSSMATE_APP_VERSION || '')],
    ['Build context', safeString(buildMeta.buildContext || buildMeta.deployContext || '')],
    ['Deploy URL', safeString(buildMeta.deployUrl || buildMeta.siteUrl || '')],
    ['SW active', controller ? 'yes' : 'no'],
    ['SW controller', controller ? `yes (${controller.state || 'unknown'})` : 'no'],
    ['Firebase source', auth.configSource || getFirebaseConfigSource()],
    ['Firebase projectId', safeString(configSummary.projectId || '')],
    ['Firebase authDomain', safeString(configSummary.authDomain || '')],
    ['Firebase apiKey', safeString(apiKeyValue)],
    ['Auth mode (preferred)', safeString(auth.preferredAuthMode || '')],
    ['Auth mode (last)', safeString(auth.lastAuthMode || '')],
    ['App Check', `${auth.appCheckStatus || ''}${auth.appCheckReason ? ` (${auth.appCheckReason})` : ''}`],
    ['App Check enabled', formatBoolean(auth.appCheckStatus === 'on')],
    ['App Check debug', formatBoolean(Boolean(auth.appCheckDebug))],
    ['Config valid', formatBoolean(Boolean(configStatus.isValid))],
    ['Missing keys', (configStatus.missingKeys || []).join(', ') || '–'],
    ['Placeholder keys', (configStatus.placeholderKeys || []).join(', ') || '–'],
    ['Cache entries', '…'],
  ]

  rows.forEach(([label, value]) => list.appendChild(createRow(label, value)))

  const envHeader = document.createElement('li')
  envHeader.className = 'auth-diagnostics-panel__row auth-diagnostics-panel__row--heading'
  envHeader.textContent = 'Env presence (runtime config)'
  list.appendChild(envHeader)

  Object.entries(envPresence).forEach(([key, value]) => {
    list.appendChild(createRow(key, formatBoolean(value)))
  })

  if (panel?.bannerEl) {
    panel.bannerEl.hidden = !apiKeyInvalid
  }
  if (panel?.signInButton) {
    panel.signInButton.disabled = apiKeyInvalid
  }

  updateCacheEntryRow(panel)
}

export async function resetServiceWorkerAndCaches() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      for (const reg of regs) {
        await reg.unregister()
      }
    }

    if ('caches' in window) {
      const keys = await caches.keys()
      for (const key of keys) {
        await caches.delete(key)
      }
    }
  } catch (error) {
    console.warn('SW reset failed', error)
  } finally {
    location.reload()
  }
}

async function handleReset(panel) {
  if (panel?.outputEl) panel.outputEl.textContent = 'Rydder caches…'
  try {
    markCacheReset()
  } catch {}
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem('cssmate_app_version')
    }
  } catch {}
  if (panel?.outputEl) panel.outputEl.textContent = 'Caches ryddet. Genindlæser…'
  await resetServiceWorkerAndCaches()
}

async function runSignInTest(panel) {
  if (panel?.outputEl) panel.outputEl.textContent = 'Kører login-test…'
  try {
    await initSharedAuth()
    const result = await loginWithProvider('google')
    const auth = getAuthDiagnostics()
    if (panel?.outputEl) {
      panel.outputEl.textContent = JSON.stringify({
        status: auth.lastAuthMode?.includes('redirect') ? 'redirect-started' : 'ok',
        mode: auth.lastAuthMode || auth.preferredAuthMode || 'popup',
        user: result ? { uid: result.uid || '', email: result.email || '' } : null,
      }, null, 2)
    }
  } catch (error) {
    const sanitized = sanitizeError(error)
    if (panel?.outputEl) {
      panel.outputEl.textContent = JSON.stringify(sanitized, null, 2)
    }
  }
}

export function mountDiagnostics({ forceVisible = false, allowSwReset = false } = {}) {
  if (typeof document === 'undefined') return null
  if (!forceVisible && !isDiagnosticsEnabled()) return null
  if (document.getElementById(PANEL_ID)) return document.getElementById(PANEL_ID)
  if (!document.body) return null

  const panel = createPanel()
  document.body.appendChild(panel)

  if (!allowSwReset && panel.resetButton) {
    panel.resetButton.disabled = true
    panel.resetButton.setAttribute('aria-disabled', 'true')
  }

  renderPanel(panel)

  initSharedAuth()
    .then(() => renderPanel(panel))
    .catch(() => renderPanel(panel))

  try {
    const summary = getFirebaseConfigSummarySnapshot()
    if (summary?.apiKeyMasked) {
      console.info('[AuthDiag] Firebase apiKey (masked):', summary.apiKeyMasked)
    }
  } catch {}

  panel.resetButton?.addEventListener('click', event => {
    event.preventDefault()
    if (allowSwReset) {
      handleReset(panel)
    }
  })

  panel.signInButton?.addEventListener('click', event => {
    event.preventDefault()
    runSignInTest(panel)
  })

  return panel
}

export function initAuthDiagnostics() {
  return mountDiagnostics({ forceVisible: false, allowSwReset: true })
}
