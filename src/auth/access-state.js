import { TEAM_ACCESS_STATUS } from '../services/team-access.js'

const SESSION_STATUS = {
  SIGNED_OUT: 'signedOut',
  SIGNING_IN: 'signingIn',
  NO_ACCESS: 'signedIn_noAccess',
  MEMBER: 'signedIn_member',
  ADMIN: 'signedIn_admin',
  ERROR: 'error',
}

function resolveMembershipStatus (accessStatus) {
  if (accessStatus === TEAM_ACCESS_STATUS.OK) return 'member'
  if (accessStatus === TEAM_ACCESS_STATUS.NO_TEAM || accessStatus === TEAM_ACCESS_STATUS.NEED_CREATE) return 'no_team'
  if (accessStatus === TEAM_ACCESS_STATUS.NO_AUTH) return 'no_auth'
  if (accessStatus === TEAM_ACCESS_STATUS.NO_ACCESS) return 'not_member'
  return 'error'
}

function resolveSessionStatus (accessStatus, isAdmin, membershipStatus) {
  if (membershipStatus === 'member') {
    return isAdmin ? SESSION_STATUS.ADMIN : SESSION_STATUS.MEMBER
  }
  if (accessStatus === TEAM_ACCESS_STATUS.NO_AUTH) return SESSION_STATUS.SIGNED_OUT
  if (accessStatus === TEAM_ACCESS_STATUS.ERROR) return SESSION_STATUS.ERROR
  return SESSION_STATUS.NO_ACCESS
}

export {
  SESSION_STATUS,
  resolveMembershipStatus,
  resolveSessionStatus,
}
