import { getDebugState, isDebugOverlayEnabled, markCacheReset, onDebugChange } from '../state/debug.js'
import { getSavedOrgId } from '../auth/org-store.js'
import { getOrganizationConfig } from '../auth/auth0-client.js'

const OVERLAY_ID = 'sscaff-debug-overlay'
const OVERLAY_STYLE = `
  position: fixed;
  top: 10px;
  right: 10px;
  z-index: 99999;
  background: rgba(0, 0, 0, 0.86);
  color: #e0e0e0;
  padding: 10px 12px;
  border-radius: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 11px;
  line-height: 1.45;
  max-width: min(360px, 92vw);
  box-shadow: 0 8px 20px rgba(0,0,0,0.35);
  pointer-events: auto;
  white-space: pre-wrap;
  word-break: break-word;
  display: flex;
  flex-direction: column;
  gap: 6px;
`

let latestState = getDebugState()
let hitTestEnabled = false
let pointerListener = null
let lastError = ''
let lastClick = null

function formatBoolean (value) {
  return value ? 'true' : 'false'
}

function summarizeElement (element) {
  if (!element || !(element instanceof Element)) return null
  return {
    tag: element.tagName?.toLowerCase() || '',
    id: element.id || '',
    className: typeof element.className === 'string' ? element.className.trim() : '',
  }
}

function summarizeStyle (element) {
  if (!element || !(element instanceof Element)) return null
  if (typeof window === 'undefined') return null
  const style = window.getComputedStyle(element)
  return {
    pointerEvents: style.pointerEvents || '',
    zIndex: style.zIndex || '',
    position: style.position || '',
  }
}

function formatElementSummary (summary) {
  if (!summary) return 'null'
  const parts = [summary.tag || '']
  if (summary.id) parts.push(`#${summary.id}`)
  if (summary.className) parts.push(`.${summary.className.split(' ').filter(Boolean).slice(0, 2).join('.')}`)
  return parts.join('')
}

function captureClickDiagnostics (event) {
  if (!event) return
  const targetSummary = summarizeElement(event.target)
  const pointX = Number.isFinite(event.clientX) ? event.clientX : 0
  const pointY = Number.isFinite(event.clientY) ? event.clientY : 0
  const topAtPoint = typeof document !== 'undefined'
    ? document.elementFromPoint(pointX, pointY)
    : null
  const topSummary = summarizeElement(topAtPoint)
  lastClick = {
    x: pointX,
    y: pointY,
    target: targetSummary,
    topAtPoint: topSummary,
    topAtPointStyle: summarizeStyle(topAtPoint),
  }
}

function handleErrorEvent (event) {
  const message = event?.message || event?.error?.message || String(event?.error || event || '')
  lastError = message
}

function handleRejectionEvent (event) {
  const reason = event?.reason
  if (reason instanceof Error) {
    lastError = reason.message
  } else if (typeof reason === 'string') {
    lastError = reason
  } else {
    try {
      lastError = JSON.stringify(reason)
    } catch {
      lastError = String(reason || '')
    }
  }
}

function getUiState () {
  const html = typeof document !== 'undefined' ? document.documentElement : null
  const body = typeof document !== 'undefined' ? document.body : null
  const app = typeof document !== 'undefined' ? document.getElementById('app') : null
  const tabBar = typeof document !== 'undefined' ? document.querySelector('[role="tablist"]') : null
  const tabButtons = typeof document !== 'undefined'
    ? Array.from(document.querySelectorAll('[role="tab"][data-tab-id]'))
    : []

  const appPointerEvents = app && typeof window !== 'undefined'
    ? window.getComputedStyle(app).pointerEvents
    : ''
  const tabBarPointerEvents = tabBar && typeof window !== 'undefined'
    ? window.getComputedStyle(tabBar).pointerEvents
    : ''

  const disabledTabs = tabButtons.filter(button => button.hasAttribute('disabled'))
  const navDisabled = !tabButtons.length
    || disabledTabs.length === tabButtons.length
    || appPointerEvents === 'none'
    || tabBarPointerEvents === 'none'

  return {
    authLockedClass: Boolean(html?.classList?.contains('auth-locked')),
    overlayOpen: Boolean(body?.classList?.contains('auth-overlay-open')),
    appInert: Boolean(app?.hasAttribute('inert')),
    appPointerEvents,
    tabBarPointerEvents,
    navDisabled,
  }
}

function buildSnapshot () {
  const state = latestState || getDebugState()
  const orgConfig = getOrganizationConfig()
  const savedOrgId = getSavedOrgId()
  const route = typeof window !== 'undefined'
    ? {
      path: window.location?.pathname || '',
      search: window.location?.search || '',
      hash: window.location?.hash || '',
      href: window.location?.href || '',
    }
    : { path: '', search: '', hash: '', href: '' }
  const ui = getUiState()
  const authUser = state?.user || {}

  return {
    authReady: Boolean(state?.authReady),
    isAuthenticated: Boolean(authUser?.uid),
    user: {
      uid: authUser?.uid || '',
      email: authUser?.email || '',
      providerIds: Array.isArray(authUser?.providerIds) ? authUser.providerIds : [],
    },
    org: {
      orgId: orgConfig?.orgId || '',
      orgSlug: orgConfig?.orgSlug || '',
      organization: orgConfig?.organization || '',
      source: orgConfig?.source || '',
      savedOrgId: savedOrgId || '',
    },
    team: {
      teamSlug: state?.teamId || '',
      teamResolved: Boolean(state?.teamResolved),
    },
    ui: {
      ...ui,
      uiLocked: ui.authLockedClass || ui.overlayOpen || ui.appInert,
    },
    route,
    lastError: lastError || (state?.accessError?.message || state?.accessError?.code || ''),
    lastClick,
    buildMeta: state?.buildMeta || {},
  }
}

function setClipboardText (value) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(value)
  }
  return new Promise((resolve, reject) => {
    try {
      const textarea = document.createElement('textarea')
      textarea.value = value
      textarea.style.position = 'fixed'
      textarea.style.top = '-1000px'
      textarea.setAttribute('readonly', 'true')
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      resolve()
    } catch (error) {
      reject(error)
    }
  })
}

async function hardReload () {
  try {
    markCacheReset()
  } catch {}
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map(reg => reg.unregister()))
    }
  } catch (error) {
    console.warn('SW unregister fejlede', error)
  }
  try {
    if (typeof caches !== 'undefined' && caches.keys) {
      const keys = await caches.keys()
      await Promise.all(keys.map(key => caches.delete(key)))
    }
  } catch (error) {
    console.warn('Cache clear fejlede', error)
  }
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem('cssmate_app_version')
    }
  } catch {}
  if (typeof window !== 'undefined') {
    window.location.reload(true)
  }
}

function renderOverlay (target, snapshot) {
  if (!target?.textEl) return
  const lines = []

  lines.push('AUTH')
  lines.push(`authReady: ${formatBoolean(snapshot.authReady)}`)
  lines.push(`isAuthenticated: ${formatBoolean(snapshot.isAuthenticated)}`)
  lines.push(`user.sub: ${snapshot.user.uid || 'null'}`)
  lines.push(`user.email: ${snapshot.user.email || ''}`)
  lines.push(`providerIds: ${snapshot.user.providerIds.join(', ')}`)

  lines.push('')
  lines.push('ORG')
  lines.push(`orgId: ${snapshot.org.orgId || ''}`)
  lines.push(`orgSlug: ${snapshot.org.orgSlug || ''}`)
  lines.push(`orgSource: ${snapshot.org.source || ''}`)
  lines.push(`savedOrgId: ${snapshot.org.savedOrgId || ''}`)

  lines.push('')
  lines.push('TEAM')
  lines.push(`teamSlug: ${snapshot.team.teamSlug || ''}`)
  lines.push(`teamResolved: ${formatBoolean(snapshot.team.teamResolved)}`)

  lines.push('')
  lines.push('UI')
  lines.push(`uiLocked: ${formatBoolean(snapshot.ui.uiLocked)}`)
  lines.push(`authLockedClass: ${formatBoolean(snapshot.ui.authLockedClass)}`)
  lines.push(`appInert: ${formatBoolean(snapshot.ui.appInert)}`)
  lines.push(`navDisabled: ${formatBoolean(snapshot.ui.navDisabled)}`)
  lines.push(`appPointerEvents: ${snapshot.ui.appPointerEvents || ''}`)
  lines.push(`tabBarPointerEvents: ${snapshot.ui.tabBarPointerEvents || ''}`)

  lines.push('')
  lines.push('ROUTE')
  lines.push(`path: ${snapshot.route.path}`)
  lines.push(`search: ${snapshot.route.search}`)
  lines.push(`hash: ${snapshot.route.hash}`)

  lines.push('')
  lines.push('LAST ERROR')
  lines.push(snapshot.lastError || 'none')

  lines.push('')
  lines.push('CLICK')
  if (snapshot.lastClick) {
    lines.push(`lastClick: ${snapshot.lastClick.x},${snapshot.lastClick.y}`)
    lines.push(`target: ${formatElementSummary(snapshot.lastClick.target)}`)
    lines.push(`topAtPoint: ${formatElementSummary(snapshot.lastClick.topAtPoint)}`)
    const style = snapshot.lastClick.topAtPointStyle || {}
    lines.push(`style: pointer-events=${style.pointerEvents || ''} z-index=${style.zIndex || ''} position=${style.position || ''}`)
  } else {
    lines.push('lastClick: none')
  }

  target.textEl.textContent = lines.join('\n')
}

function updateOverlay (target) {
  const snapshot = buildSnapshot()
  if (typeof window !== 'undefined') {
    window.__SSCaffDebugDump = () => JSON.stringify(snapshot, null, 2)
  }
  renderOverlay(target, snapshot)
}

function toggleHitTest (target, enabled) {
  if (typeof document === 'undefined') return
  hitTestEnabled = Boolean(enabled)
  if (hitTestEnabled && !pointerListener) {
    pointerListener = event => {
      captureClickDiagnostics(event)
      updateOverlay(target)
    }
    document.addEventListener('pointerdown', pointerListener, { capture: true, passive: true })
  } else if (!hitTestEnabled && pointerListener) {
    document.removeEventListener('pointerdown', pointerListener, { capture: true })
    pointerListener = null
  }
  updateOverlay(target)
}

function createOverlay () {
  const container = document.createElement('div')
  container.id = OVERLAY_ID
  container.setAttribute('aria-live', 'polite')
  container.setAttribute('aria-label', 'Debug overlay')
  container.style.cssText = OVERLAY_STYLE
  container.title = 'Aktiveres med ?debug=1 eller VITE_DEBUG_AUTH=1'

  const header = document.createElement('div')
  header.style.display = 'flex'
  header.style.justifyContent = 'space-between'
  header.style.alignItems = 'center'
  header.style.gap = '8px'

  const title = document.createElement('strong')
  title.textContent = 'Debug'

  const toggleWrap = document.createElement('label')
  toggleWrap.style.display = 'inline-flex'
  toggleWrap.style.alignItems = 'center'
  toggleWrap.style.gap = '4px'
  toggleWrap.style.fontSize = '11px'

  const toggleInput = document.createElement('input')
  toggleInput.type = 'checkbox'
  toggleInput.style.margin = '0'
  toggleInput.addEventListener('change', () => {
    toggleHitTest(container, toggleInput.checked)
  })

  const toggleText = document.createElement('span')
  toggleText.textContent = 'Hit-test'

  toggleWrap.append(toggleInput, toggleText)
  header.append(title, toggleWrap)

  const textEl = document.createElement('pre')
  textEl.style.margin = '0'
  textEl.style.whiteSpace = 'pre-wrap'

  const actions = document.createElement('div')
  actions.style.display = 'flex'
  actions.style.flexWrap = 'wrap'
  actions.style.gap = '6px'

  const copyBtn = document.createElement('button')
  copyBtn.type = 'button'
  copyBtn.textContent = 'Copy debug'
  copyBtn.style.display = 'inline-flex'
  copyBtn.style.alignItems = 'center'
  copyBtn.style.justifyContent = 'center'
  copyBtn.style.padding = '6px 10px'
  copyBtn.style.borderRadius = '8px'
  copyBtn.style.border = '1px solid rgba(255,255,255,0.2)'
  copyBtn.style.background = '#111827'
  copyBtn.style.color = '#e0e0e0'
  copyBtn.style.cursor = 'pointer'
  copyBtn.addEventListener('click', async event => {
    event.preventDefault()
    event.stopPropagation()
    const dump = typeof window !== 'undefined' && typeof window.__SSCaffDebugDump === 'function'
      ? window.__SSCaffDebugDump()
      : JSON.stringify(buildSnapshot(), null, 2)
    try {
      await setClipboardText(dump)
      copyBtn.textContent = 'Copied!'
      setTimeout(() => {
        copyBtn.textContent = 'Copy debug'
      }, 1200)
    } catch {
      copyBtn.textContent = 'Copy failed'
      setTimeout(() => {
        copyBtn.textContent = 'Copy debug'
      }, 1500)
    }
  })

  const resetBtn = document.createElement('button')
  resetBtn.type = 'button'
  resetBtn.textContent = 'Ryd cache + genindlæs'
  resetBtn.style.display = 'inline-flex'
  resetBtn.style.alignItems = 'center'
  resetBtn.style.justifyContent = 'center'
  resetBtn.style.padding = '6px 10px'
  resetBtn.style.borderRadius = '8px'
  resetBtn.style.border = '1px solid rgba(255,255,255,0.2)'
  resetBtn.style.background = '#1f2933'
  resetBtn.style.color = '#e0e0e0'
  resetBtn.style.cursor = 'pointer'
  resetBtn.addEventListener('click', event => {
    event.preventDefault()
    event.stopPropagation()
    hardReload()
  })

  actions.append(copyBtn, resetBtn)

  container.append(header, textEl, actions)
  container.textEl = textEl
  return container
}

export function initDebugOverlay () {
  if (!isDebugOverlayEnabled()) return
  if (typeof document === 'undefined') return
  if (document.getElementById(OVERLAY_ID)) return

  const el = createOverlay()

  if (document.body) {
    document.body.appendChild(el)
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (!document.getElementById(OVERLAY_ID)) {
        document.body.appendChild(el)
      }
    }, { once: true })
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('error', event => {
      handleErrorEvent(event)
      updateOverlay(el)
    })
    window.addEventListener('unhandledrejection', event => {
      handleRejectionEvent(event)
      updateOverlay(el)
    })
  }

  onDebugChange(state => {
    latestState = state
    updateOverlay(el)
  })
  updateOverlay(el)
}
