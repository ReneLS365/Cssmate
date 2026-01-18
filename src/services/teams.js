import { DEFAULT_TEAM_ID, formatTeamId } from './team-ids.js'

export function buildMemberDocPath (teamIdInput, uid) {
  if (!uid) throw new Error('UID påkrævet for medlemsdokument')
  const teamId = formatTeamId(teamIdInput || DEFAULT_TEAM_ID)
  return `teams/${teamId}/members/${uid}`
}
