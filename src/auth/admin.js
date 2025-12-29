import { isAdminEmail } from './roles.js'

export function isAdminSession (session) {
  const role = session?.member?.role || session?.role || ''
  return role === 'admin' || role === 'owner' || isAdminEmail(session?.user?.email)
}

export function assertAdmin (session, actionLabel = 'Denne handling') {
  if (isAdminSession(session)) return true
  const error = new Error(`${actionLabel} kræver admin-adgang.`)
  error.code = 'not-admin'
  throw error
}
