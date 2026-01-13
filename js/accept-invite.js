import { initAuth0, isAuthenticated, login } from '../src/auth/auth0-client.js'
import { apiJson } from '../src/api/client.js'
import { persistTeamId } from '../src/services/team-ids.js'

export const PENDING_INVITE_KEY = 'cssmate:pendingInvite'

const statusEl = document.getElementById('inviteStatus')
const loginButton = document.getElementById('inviteLogin')
const retryButton = document.getElementById('inviteRetry')

function readInviteParams () {
  const params = new URLSearchParams(window.location.search)
  return {
    token: params.get('token') || '',
  }
}

function storePendingInvite (token) {
  if (!token) return
  try {
    window.localStorage?.setItem(PENDING_INVITE_KEY, JSON.stringify({ token }))
  } catch {
    // ignore storage errors
  }
}

function clearPendingInvite () {
  try {
    window.localStorage?.removeItem(PENDING_INVITE_KEY)
  } catch {
    // ignore storage errors
  }
}

function setStatus (message, variant = '') {
  if (!statusEl) return
  statusEl.textContent = message || ''
  statusEl.dataset.variant = variant || ''
}

export async function acceptInvite (token) {
  try {
    const result = await apiJson('/api/invites/accept', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
    if (result?.teamId) {
      persistTeamId(result.teamId)
    }
    clearPendingInvite()
    return result
  } catch (error) {
    if (error?.status === 401) {
      storePendingInvite(token)
      if (loginButton) loginButton.hidden = false
      setStatus('Sessionen er udløbet. Log ind for at acceptere invitationen.', 'error')
      return null
    }
    if (error?.status === 403) {
      const invitedEmail = error?.payload?.invitedEmail || ''
      const loginEmail = error?.payload?.loginEmail || ''
      if (invitedEmail || loginEmail) {
        setStatus(`Email matcher ikke invitationen. Inviteret: ${invitedEmail}. Logget ind: ${loginEmail}.`, 'error')
        if (loginButton) loginButton.hidden = false
        return null
      }
    }
    throw error
  }
}

function handleLoginRedirect () {
  const { token } = readInviteParams()
  if (!token) return
  login({ token }).catch(() => {})
}

async function handleInvite () {
  const { token } = readInviteParams()
  if (!token) {
    setStatus('Invite-link mangler oplysninger.', 'error')
    return
  }
  setStatus('Accepterer invitation…')
  try {
    const response = await acceptInvite(token)
    if (response?.ok) {
      setStatus('Invitation accepteret. Du sendes videre…', 'success')
      setTimeout(() => {
        window.location.href = '/'
      }, 1200)
      return
    }
    setStatus('Kunne ikke acceptere invitationen.', 'error')
  } catch (error) {
    setStatus(error?.message || 'Kunne ikke acceptere invitationen.', 'error')
    if (retryButton) retryButton.hidden = false
  }
}

function storeFromRedirect () {
  const { token } = readInviteParams()
  if (!token) return
  storePendingInvite(token)
  login({ token }).catch(() => {})
}

async function init () {
  try {
    await initAuth0()
    const authenticated = await isAuthenticated()
    if (!authenticated) {
      storeFromRedirect()
      return
    }
    await handleInvite()
  } catch (error) {
    setStatus(error?.message || 'Kunne ikke initialisere login.', 'error')
    if (retryButton) retryButton.hidden = false
  }
}

if (loginButton) {
  loginButton.addEventListener('click', handleLoginRedirect)
}

if (retryButton) {
  retryButton.addEventListener('click', () => {
    handleInvite().catch(() => {})
  })
}

init()
