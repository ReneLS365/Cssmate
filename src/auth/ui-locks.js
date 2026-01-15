export function hardClearUiLocks () {
  try { document.documentElement?.classList?.remove('auth-locked') } catch {}
  try { document.body?.classList?.remove('auth-overlay-open') } catch {}
  try { document.querySelector('#app')?.removeAttribute('inert') } catch {}
  try {
    const authGate = document.getElementById('authGate')
    if (authGate) {
      authGate.setAttribute('hidden', '')
      authGate.removeAttribute('data-locked')
    }
  } catch {}
  try {
    const overlay = document.querySelector('[data-auth-overlay], #auth-overlay, .auth-overlay')
    if (overlay) {
      overlay.style.pointerEvents = 'none'
      overlay.style.display = 'none'
    }
  } catch {}
}
