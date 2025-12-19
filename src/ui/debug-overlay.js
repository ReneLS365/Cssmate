import { isDebugOverlayEnabled, onDebugChange } from '../state/debug.js'

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
  pointer-events: none;
  white-space: pre-wrap;
  word-break: break-word;
`

function formatBoolean (value) {
  return value ? 'true' : 'false'
}

function renderOverlay (container, state) {
  if (!container) return
  const lines = []

  lines.push('AUTH')
  lines.push(`authReady: ${formatBoolean(state.authReady)}`)
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

  lines.push('')
  lines.push('SESSION')
  lines.push(`sessionReady: ${formatBoolean(state.sessionReady)}`)
  lines.push(`sessionStatus: ${state.sessionStatus || ''}`)
  lines.push(`currentView: ${state.currentView || ''}`)

  lines.push('')
  lines.push('FIRESTORE')
  lines.push(`lastFirestoreError.code: ${state.lastFirestoreError?.code || ''}`)
  lines.push(`lastFirestoreError.message: ${state.lastFirestoreError?.message || ''}`)
  lines.push(`lastFirestoreError.path: ${state.lastFirestoreError?.path || ''}`)

  container.textContent = lines.join('\n')
}

export function initDebugOverlay () {
  if (!isDebugOverlayEnabled()) return
  if (typeof document === 'undefined') return
  if (document.getElementById(OVERLAY_ID)) return

  const el = document.createElement('pre')
  el.id = OVERLAY_ID
  el.setAttribute('aria-live', 'polite')
  el.setAttribute('aria-label', 'Debug overlay')
  el.style.cssText = OVERLAY_STYLE
  el.title = 'Aktiveres med localStorage.sscaffDebug = "1"'

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
