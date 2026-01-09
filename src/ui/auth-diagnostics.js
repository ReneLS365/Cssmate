import { getAuthDiagnostics, initSharedAuth } from '../../js/shared-auth.js'
import { getDebugState, markCacheReset } from '../state/debug.js'
import { resetApp } from '../utils/reset-app.js'

const PANEL_ID = 'authDiagnosticsPanel'
const RESET_PANEL_ID = 'authDiagnosticsReset'
let resetFlowStarted = false

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

function isResetRequested() {
  try {
    if (typeof window === 'undefined') return false
    const params = new URLSearchParams(window.location.search)
    return params.get('reset') === '1'
  } catch (_) {
    return false
  }
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

  const actions = document.createElement('div')
  actions.className = 'auth-diagnostics-panel__actions'

  const resetButton = document.createElement('button')
  resetButton.type = 'button'
  resetButton.textContent = 'Reset SW + caches'

  actions.append(resetButton)

  const output = document.createElement('pre')
  output.className = 'auth-diagnostics-panel__output'
  output.textContent = 'Ingen auth-test kørt endnu.'

  panel.append(header, list, actions, output)
  panel.listEl = list
  panel.outputEl = output
  panel.resetButton = resetButton
  return panel
}

function createResetPanel() {
  const panel = document.createElement('section')
  panel.id = RESET_PANEL_ID
  panel.className = 'auth-diagnostics-panel'
  panel.setAttribute('aria-live', 'polite')

  const header = document.createElement('header')
  header.className = 'auth-diagnostics-panel__header'
  const title = document.createElement('h2')
  title.textContent = 'Resetting…'
  const subtitle = document.createElement('p')
  subtitle.className = 'auth-diagnostics-panel__hint'
  subtitle.textContent = 'Rydder service worker, cache og lokal data.'
  header.append(title, subtitle)

  const output = document.createElement('pre')
  output.className = 'auth-diagnostics-panel__output'
  output.textContent = 'Resetting…'

  panel.append(header, output)
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
  const diagnostics = getAuthDiagnostics()
  const state = getDebugState()
  const list = panel.listEl
  list.textContent = ''
  list.append(
    createRow('Auth ready', diagnostics?.authReady ? 'true' : 'false'),
    createRow('Authenticated', diagnostics?.isAuthenticated ? 'true' : 'false'),
    createRow('Email', diagnostics?.userEmail || '–'),
    createRow('Last auth error', diagnostics?.lastAuthErrorCode || '–'),
    createRow('Team ID', state?.teamId || '–'),
    createRow('Cache entries', '…')
  )
  updateCacheEntryRow(panel)
}

function mountPanel(panel) {
  if (document.getElementById(PANEL_ID)) return
  document.body.append(panel)
}

function mountResetPanel(panel) {
  if (document.getElementById(RESET_PANEL_ID)) return
  document.body.append(panel)
}

async function runReset(panel) {
  if (resetFlowStarted) return
  resetFlowStarted = true
  mountResetPanel(panel)
  markCacheReset()
  await resetApp()
  window.location.href = '/?diag=1'
}

export async function mountDiagnostics() {
  if (!isDiagnosticsEnabled()) return
  await initSharedAuth()

  const panel = createPanel()
  mountPanel(panel)
  renderPanel(panel)

  if (panel.resetButton) {
    panel.resetButton.addEventListener('click', () => runReset(createResetPanel()))
  }

  if (isResetRequested()) {
    runReset(createResetPanel())
  }
}

