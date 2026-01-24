import { getToken } from '../auth/auth0-client.js'
import { getDeployContext, getPreviewWriteDisabledMessage } from '../lib/deploy-context.js'
import { getUserEmail, getUserOrgId, getUserSub } from '../lib/auth0-user.js'
import { isDebugOverlayEnabled } from '../state/debug.js'
import { DEFAULT_TEAM_SLUG, formatTeamId } from './team-ids.js'

let registrationKey = ''
let registrationPromise = null

function debugLog (label, details = {}) {
  if (!isDebugOverlayEnabled()) return
  const safeDetails = details && typeof details === 'object'
    ? Object.fromEntries(Object.entries(details).filter(([key]) => !/token|secret|password/i.test(key)))
    : details
  try {
    console.info(`[team-members] ${label}`, safeDetails)
  } catch {}
}

function buildRegistrationKey ({ teamId, sub, role, orgId }) {
  if (!teamId || !sub) return ''
  return [teamId, sub, role || '', orgId || ''].join(':')
}

function createPreviewDisabledError (context) {
  const error = new Error(getPreviewWriteDisabledMessage())
  error.code = 'preview-disabled'
  error.status = 403
  error.context = context?.context || ''
  return error
}

export async function registerTeamMemberOnce ({ teamId, user, userId, role = '', orgId } = {}) {
  const resolvedTeamId = formatTeamId(teamId || DEFAULT_TEAM_SLUG)
  const sub = getUserSub(user) || (userId ? String(userId) : '')
  if (!resolvedTeamId || !sub) return null
  const resolvedOrgId = orgId || getUserOrgId(user)
  const key = buildRegistrationKey({ teamId: resolvedTeamId, sub, role, orgId: resolvedOrgId })
  if (registrationKey === key && registrationPromise) return registrationPromise
  registrationKey = key
  registrationPromise = registerTeamMember({
    teamId: resolvedTeamId,
    sub,
    email: getUserEmail(user),
    role,
    orgId: resolvedOrgId,
  })
    .finally(() => {
      registrationPromise = null
    })
  return registrationPromise
}

async function registerTeamMember ({ teamId, sub, email, role, orgId }) {
  const context = getDeployContext()
  if (!context.writesAllowed) {
    const error = createPreviewDisabledError(context)
    debugLog('register-skipped-preview', { teamId, sub, context })
    throw error
  }
  const token = await getToken()
  const response = await fetch(`/api/teams/${encodeURIComponent(teamId)}/members/self`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sub, email, role, orgId }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = payload?.error || 'Kunne ikke registrere medlem'
    const error = new Error(message)
    error.status = response.status
    if (payload?.code) error.code = payload.code
    debugLog('register-failed', { teamId, sub, status: response.status, code: error.code || '', message })
    throw error
  }
  debugLog('register-success', { teamId, sub, role: payload?.member?.role || role, orgId: orgId || '' })
  return payload
}
