const EMAIL_CLAIMS = [
  'https://sscaff.app/email',
  'email',
]

const NAME_CLAIMS = [
  'name',
  'nickname',
]

const ORG_CLAIMS = [
  'https://sscaff.app/org_id',
  'org_id',
  'orgId',
]

function readFirstClaim (user, keys = []) {
  if (!user || typeof user !== 'object') return ''
  for (const key of keys) {
    const value = user[key]
    if (value == null) continue
    const normalized = String(value).trim()
    if (normalized) return normalized
  }
  return ''
}

export function getUserSub (user) {
  return readFirstClaim(user, ['sub', 'uid'])
}

export function getUserEmail (user) {
  return readFirstClaim(user, EMAIL_CLAIMS)
}

export function getUserName (user) {
  const name = readFirstClaim(user, NAME_CLAIMS)
  if (name) return name
  const email = getUserEmail(user)
  if (email) return email
  return getUserSub(user)
}

export function getUserOrgId (user) {
  return readFirstClaim(user, ORG_CLAIMS)
}
