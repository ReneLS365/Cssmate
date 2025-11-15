import { isAdminUnlocked } from '../../state/admin.js'

const ADMIN_GUARD_SELECTOR = '[data-requires-admin]'

function shouldBypass (target) {
  if (!(target instanceof Element)) return true
  if (target.closest('[data-allow-click]')) return true
  return false
}

export function initClickGuard () {
  if (typeof document === 'undefined') return

  const blockEvent = event => {
    const target = event.target
    if (shouldBypass(target)) return
    if (!isAdminUnlocked() && target instanceof Element && target.matches(ADMIN_GUARD_SELECTOR)) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }

  document.addEventListener('pointerdown', blockEvent, true)
  document.addEventListener('focusin', blockEvent, true)
}
