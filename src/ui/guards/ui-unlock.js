import { diagnoseInputBlockers } from '../../dev/tab-diagnostics.js'
import { hardClearUiLocks } from '../../auth/ui-locks.js'

let recoveryInstalled = false
let ensureTabsRebindPending = false

function tryRebindTabs () {
  if (typeof window === 'undefined') return
  if (typeof window.__cssmateEnsureTabsBound === 'function') {
    window.__cssmateEnsureTabsBound()
    return
  }
  if (ensureTabsRebindPending) return
  ensureTabsRebindPending = true
  import('../../../app-main.js')
    .then(mod => {
      if (typeof mod?.ensureTabsBound === 'function') {
        mod.ensureTabsBound()
      }
    })
    .catch(() => {})
    .finally(() => {
      ensureTabsRebindPending = false
    })
}

export function ensureUiInteractive (reason = 'ui-unlock') {
  if (typeof document === 'undefined' || typeof window === 'undefined') return

  hardClearUiLocks(reason)

  try {
    document.documentElement?.classList?.remove('auth-locked')
  } catch {}

  try {
    const app = document.getElementById('app')
    if (app) {
      app.removeAttribute('inert')
      app.removeAttribute('aria-hidden')
    }
  } catch {}

  try {
    document.body?.classList?.remove('auth-overlay-open')
  } catch {}

  const blockers = diagnoseInputBlockers({ documentRef: document, windowRef: window })
  blockers.forEach(blocker => {
    const element = blocker.element
    if (!element || !element.style) return
    element.style.pointerEvents = 'none'
    element.style.display = 'none'
    if (typeof element.setAttribute === 'function') {
      element.setAttribute('data-auto-disabled', reason || 'ui-unlock')
    }
  })

  tryRebindTabs()
}

export function installTabClickRecovery () {
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  if (recoveryInstalled) return
  recoveryInstalled = true

  const attachListener = () => {
    const tabList = document.querySelector('[role="tablist"]')
    if (!tabList) {
      setTimeout(attachListener, 120)
      return
    }

    tabList.addEventListener('pointerdown', event => {
      const target = event.target
      if (!(target instanceof Element)) return
      const tab = target.closest('[role="tab"][data-tab-id]')
      if (!tab) return

      const requestedTabId = tab.dataset?.tabId || ''
      const initialActiveId = document.querySelector('[role="tab"][aria-selected="true"]')?.dataset?.tabId || ''
      if (requestedTabId && requestedTabId === initialActiveId) return

      const prevented = event.defaultPrevented
      setTimeout(() => {
        const currentActiveId = document.querySelector('[role="tab"][aria-selected="true"]')?.dataset?.tabId || ''
        if (!prevented && currentActiveId === initialActiveId) {
          ensureUiInteractive('tab-click-noop')
        }
      }, 80)
    }, true)
  }

  attachListener()
}
