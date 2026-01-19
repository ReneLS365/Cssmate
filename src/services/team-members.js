import { getToken } from '../auth/auth0-client.js'
import { DEFAULT_TEAM_SLUG, formatTeamId } from './team-ids.js'

let registrationKey = ''
let registrationPromise = null

export async function registerTeamMemberOnce ({ teamId, userId }) {
  const resolvedTeamId = formatTeamId(teamId || DEFAULT_TEAM_SLUG)
  if (!resolvedTeamId) return null
  const key = `${resolvedTeamId}:${userId || 'anon'}`
  if (registrationKey === key && registrationPromise) return registrationPromise
  registrationKey = key
  registrationPromise = registerTeamMember({ teamId: resolvedTeamId })
    .catch(error => {
      console.warn('Kunne ikke registrere medlem', error)
      return null
    })
    .finally(() => {
      registrationPromise = null
    })
  return registrationPromise
}

async function registerTeamMember ({ teamId }) {
  const token = await getToken()
  const response = await fetch(`/api/teams/${encodeURIComponent(teamId)}/members/self`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = payload?.error || 'Kunne ikke registrere medlem'
    throw new Error(message)
  }
  return payload
}
