import { initAuthSession } from './session.js'
import { initAuthProvider } from './auth-provider.js'
import { getAuthContext, initSharedAuth, onAuthStateChange } from '../../js/shared-auth.js'
import { isLighthouseMode } from '../config/lighthouse-mode.js'

let bootstrapPromise = null
const PENDING_INVITE_KEY = 'cssmate:pendingInvite'

function readPendingInvite () {
  try {
    const raw = window.localStorage?.getItem(PENDING_INVITE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function clearPendingInvite () {
  try {
    window.localStorage?.removeItem(PENDING_INVITE_KEY)
  } catch {
    // ignore
  }
}

function maybeRedirectPendingInvite () {
  if (typeof window === 'undefined') return
  const pending = readPendingInvite()
  if (!pending?.inviteId || !pending?.token) return
  const auth = getAuthContext()
  if (!auth?.isAuthenticated) return
  clearPendingInvite()
  const params = new URLSearchParams({ inviteId: pending.inviteId, token: pending.token })
  window.location.href = `/accept-invite?${params.toString()}`
}

export function initAuth () {
  if (bootstrapPromise) return bootstrapPromise
  if (isLighthouseMode()) {
    bootstrapPromise = Promise.resolve()
    return bootstrapPromise
  }
  bootstrapPromise = (async () => {
    try {
      await initSharedAuth()
    } catch (error) {
      console.warn('Auth bootstrap fejlede', error)
    }
    try {
      initAuthProvider()
      initAuthSession()
      onAuthStateChange(() => maybeRedirectPendingInvite())
      maybeRedirectPendingInvite()
    } catch (error) {
      console.warn('Auth session bootstrap fejlede', error)
    }
  })()
  return bootstrapPromise
}
