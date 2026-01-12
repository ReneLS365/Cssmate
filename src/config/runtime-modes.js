import { isLighthouseMode } from './lighthouse-mode.js'

function readCiMeta () {
  if (typeof document === 'undefined') return false
  const meta = document.querySelector('meta[name="cssmate-is-ci"]')
  return meta?.getAttribute('content') === '1'
}

function readCiWindowFlag () {
  return typeof window !== 'undefined' && window.CSSMATE_IS_CI === true
}

function readCiEnvFlag () {
  if (typeof process === 'undefined' || !process.env) return false
  return process.env.CI === '1' || process.env.CI === 'true' || process.env.CSSMATE_IS_CI === '1'
}

export function isCi () {
  return readCiMeta() || readCiWindowFlag() || readCiEnvFlag()
}

export function isLighthouse () {
  if (isLighthouseMode()) return true
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search || '')
    if (params.get('lh') === '1') return true
    if (window.CSSMATE_IS_LIGHTHOUSE === true) return true
  }
  if (typeof process !== 'undefined' && process.env) {
    return process.env.LIGHTHOUSE === '1'
  }
  return false
}

export function isAutomated () {
  const webdriver = typeof navigator !== 'undefined' && navigator.webdriver
  return isCi() || isLighthouse() || Boolean(webdriver)
}
