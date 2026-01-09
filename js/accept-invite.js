import { apiJson, getAuthToken } from '../src/api/client.js'
import { persistTeamId } from '../src/services/team-ids.js'

const PENDING_INVITE_KEY = 'cssmate:pendingInvite'

const statusEl = document.getElementById('inviteStatus')
const loginButton = document.getElementById('inviteLogin')
const retryButton = document.getElementById('inviteRetry')

function setStatus (message, variant = '') {
  if (!statusEl) return
  statusEl.textContent = message
  statusEl.dataset.variant = variant
}

function readInviteParams () {
  const params = new URLSearchParams(window.location.search)
  return {
    inviteId: params.get('inviteId') || '',
    token: params.get('token') || '',
  }
}

function storePendingInvite (inviteId, token) {
  try {
    window.localStorage?.setItem(PENDING_INVITE_KEY, JSON.stringify({ inviteId, token }))
  } catch {
    // ignore
  }
}

async function acceptInvite (inviteId, token) {
  setStatus('Accepterer invitation…')
  try {
    const result = await apiJson('/api/invites/accept', {
      method: 'POST',
      body: JSON.stringify({ inviteId, token }),
    })
    if (result?.teamId) {
      persistTeamId(result.teamId)
    }
    setStatus('Invitation accepteret. Sender dig videre…', 'success')
    setTimeout(() => {
      window.location.href = '/index.html'
    }, 800)
  } catch (error) {
    setStatus(error?.message || 'Ugyldig/udløbet invitation.', 'error')
    if (retryButton) retryButton.hidden = false
  }
}

function handleLoginRedirect () {
  const { inviteId, token } = readInviteParams()
  if (!inviteId || !token) return
  storePendingInvite(inviteId, token)
  window.location.href = '/index.html'
}

async function init () {
  const { inviteId, token } = readInviteParams()
  if (!inviteId || !token) {
    setStatus('Invite-link mangler oplysninger.', 'error')
    return
  }
  if (!getAuthToken()) {
    setStatus('Log ind for at acceptere invitationen.')
    if (loginButton) loginButton.hidden = false
    return
  }
  await acceptInvite(inviteId, token)
}

if (loginButton) {
  loginButton.addEventListener('click', handleLoginRedirect)
}
if (retryButton) {
  retryButton.addEventListener('click', () => {
    retryButton.hidden = true
    const { inviteId, token } = readInviteParams()
    if (inviteId && token) {
      acceptInvite(inviteId, token)
    }
  })
}

init()
