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
    // ignore storage errors
  }
}

function maybeRedirectPendingInvite () {
  const pending = readPendingInvite()
  if (!pending?.token) return
  clearPendingInvite()
  const params = new URLSearchParams({ token: pending.token })
  window.location.href = `/invite?${params.toString()}`
}

export function onAuthBootstrap ({ onAuthStateChange }) {
  if (!onAuthStateChange) return
  onAuthStateChange(() => maybeRedirectPendingInvite())
  maybeRedirectPendingInvite()
}
