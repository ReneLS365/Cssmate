import { BUILD_CONTEXT } from '../version.js'

function readEnvFlag (value) {
  if (value == null) return false
  const normalized = String(value).trim().toLowerCase()
  return normalized === '1' || normalized === 'true'
}

function isProductionContext (embeddedEnv = {}) {
  if (BUILD_CONTEXT === 'production') return true
  const context = String(embeddedEnv.CONTEXT || embeddedEnv.NETLIFY_CONTEXT || '').toLowerCase()
  return context === 'production'
}

function isSkipAuthGateAllowed () {
  const metaEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}
  const windowEnv = typeof window !== 'undefined' ? window : {}
  const embeddedEnv = windowEnv.__ENV__ || {}
  if (isProductionContext(embeddedEnv)) {
    return false
  }
  const devFlag = Boolean(metaEnv.DEV)
  const e2eFlag = readEnvFlag(
    metaEnv.VITE_E2E_BYPASS_AUTH
      || embeddedEnv.VITE_E2E_BYPASS_AUTH
      || windowEnv.VITE_E2E_BYPASS_AUTH
  )
  return devFlag || e2eFlag
}

export function shouldSkipAuthGate () {
  if (typeof window === 'undefined') return false
  if (!isSkipAuthGateAllowed()) return false
  const params = new URLSearchParams(window.location.search || '')
  const flag = params.get('skipAuthGate')
  return flag === '1' || flag === 'true'
}
