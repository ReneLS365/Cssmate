import { isDebugOverlayEnabled, onDebugChange, markCacheReset } from '../state/debug.js'

const OVERLAY_ID = 'sscaff-debug-overlay'
const OVERLAY_STYLE = `
  position: fixed;
  right: 10px;
  bottom: 10px;
  z-index: 99999;
  background: rgba(0, 0, 0, 0.85);
  color: #e0e0e0;
  padding: 10px 12px;
  border-radius: 10px;
  font-family: ui-monospace, SFMono-Regular, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 11px;
  line-height: 1.5;
  max-width: 320px;
  box-shadow: 0 8px 20px rgba(0,0,0,0.35);
  pointer-events: auto;
  white-space: pre-wrap;
  word-break: break-word;
`

function formatBoolean (value) {
  return value ? 'true' : 'false'
}

function renderOverlay (target, state) {
  if (!target?.textEl) return
  const lines = []

  lines.push('AUTH')
  lines.push(`authReady: ${formatBoolean(state.authReady)}`)
  lines.push(`authGateReason: ${state.authGateReason || ''}`)
  lines.push(`user.uid: ${state.user?.uid || 'null'}`)
  lines.push(`user.email: ${state.user?.email || ''}`)
  lines.push(`providerIds: ${(state.user?.providerIds || []).join(', ')}`)
  lines.push(`emailVerified: ${formatBoolean(state.user?.emailVerified)}`)

  lines.push('')
  lines.push('TEAM')
  lines.push(`teamId: ${state.teamId || ''}`)
  lines.push(`teamResolved: ${formatBoolean(state.teamResolved)}`)
  lines.push(`memberDoc.exists: ${formatBoolean(state.memberExists)}`)
  lines.push(`member.active: ${state.memberActive === null ? 'null' : formatBoolean(state.memberActive)}`)
  lines.push(`member.role: ${state.memberRole || ''}`)
  lines.push(`membershipStatus: ${state.membershipStatus || ''}`)
  lines.push(`memberPath: ${state.membershipCheckPath || ''}`)

  lines.push('')
  lines.push('SESSION')
  lines.push(`sessionReady: ${formatBoolean(state.sessionReady)}`)
  lines.push(`sessionStatus: ${state.sessionStatus || ''}`)
  lines.push(`currentView: ${state.currentView || ''}`)

  lines.push('')
  lines.push('BUILD')
  lines.push(`Build: ${state.buildMeta?.appVersion || ''} ${state.buildMeta?.gitSha || ''}`)
  lines.push(`Built: ${state.buildMeta?.buildTime || ''}`)
  lines.push(`Cache key: ${state.buildMeta?.cacheKey || ''}`)
  lines.push(`Firebase projectId: ${state.buildMeta?.firebaseProjectId || ''}`)
  if (Array.isArray(state.buildMeta?.allowedFirebaseProjects) && state.buildMeta.allowedFirebaseProjects.length) {
    lines.push(`Allowed projects: ${state.buildMeta.allowedFirebaseProjects.join(', ')}`)
  }
  if (state.buildMeta && state.buildMeta.firebaseProjectAllowed === false) {
    lines.push('⚠️ Firebase projectId ikke på allowlist')
  }
  if (state.lastCacheResetAt) {
    lines.push(`Sidst ryddet cache: ${state.lastCacheResetAt}`)
  }

  lines.push('')
  lines.push('FIRESTORE')
  lines.push(`lastFirestoreError.code: ${state.lastFirestoreError?.code || ''}`)
  lines.push(`lastFirestoreError.message: ${state.lastFirestoreError?.message || ''}`)
  lines.push(`lastFirestoreError.path: ${state.lastFirestoreError?.path || ''}`)

  target.textEl.textContent = lines.join('\n')
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

function createOverlay () {
  const container = document.createElement('div')
  container.id = OVERLAY_ID
  container.setAttribute('aria-live', 'polite')
  container.setAttribute('aria-label', 'Debug overlay')
  container.style.cssText = OVERLAY_STYLE
  container.title = 'Aktiveres med localStorage.sscaffDebug = "1"'

  const textEl = document.createElement('pre')
  textEl.style.margin = '0 0 8px 0'
  textEl.style.whiteSpace = 'pre-wrap'

  const btn = document.createElement('button')
  btn.type = 'button'
  btn.textContent = 'Ryd cache + genindlæs'
  btn.style.display = 'inline-flex'
  btn.style.alignItems = 'center'
  btn.style.justifyContent = 'center'
  btn.style.padding = '6px 10px'
  btn.style.borderRadius = '8px'
  btn.style.border = '1px solid rgba(255,255,255,0.2)'
  btn.style.background = '#1f2933'
  btn.style.color = '#e0e0e0'
  btn.style.cursor = 'pointer'
  btn.addEventListener('click', event => {
    event.preventDefault()
    event.stopPropagation()
    hardReload()
  })

  container.appendChild(textEl)
  container.appendChild(btn)
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

  onDebugChange(state => renderOverlay(el, state))
}
