import { BUILD_CONTEXT } from '../version.js'
import { isDebugOverlayEnabled } from '../state/debug.js'

const DEFAULT_PROD_HOSTS = new Set(['sscaff.netlify.app'])
const PREVIEW_CONTEXTS = new Set(['deploy-preview', 'branch-deploy'])

let loggedDebug = false

function sanitizeEnvContext (value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return ''
  if (normalized.includes('${') || normalized.includes('}')) return ''
  if (normalized === 'undefined' || normalized === 'null') return ''
  return normalized
}

function sanitizeEnvHosts (value) {
  const normalized = String(value || '').trim()
  if (!normalized) return []
  if (normalized.includes('${') || normalized.includes('}')) return []
  if (normalized.toLowerCase() === 'undefined' || normalized.toLowerCase() === 'null') return []
  return normalized
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
}

function readEnvValue (key) {
  const metaEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}
  const embeddedEnv = typeof window !== 'undefined' ? (window.__ENV__ || {}) : {}
  return metaEnv[key] || embeddedEnv[key] || ''
}

function readEnvContext () {
  const context = readEnvValue('VITE_NETLIFY_CONTEXT')
    || readEnvValue('CONTEXT')
    || readEnvValue('NETLIFY_CONTEXT')
    || BUILD_CONTEXT
    || ''
  return sanitizeEnvContext(context)
}

function readEnvProdHosts () {
  const prodHosts = readEnvValue('VITE_PROD_HOSTS')
    || readEnvValue('PROD_HOSTS')
    || ''
  return sanitizeEnvHosts(prodHosts)
}

function readHostname () {
  if (typeof window === 'undefined') return ''
  return String(window.location?.hostname || '').trim().toLowerCase()
}

function computePreviewFromHostname (hostname, prodHosts) {
  if (!hostname) return { isDeployPreview: false, isBranchDeploy: false, isPreview: false }
  const isDeployPreview = hostname.startsWith('deploy-preview-')
  const isBranchDeploy = hostname.includes('--')
    && hostname.endsWith('.netlify.app')
    && !prodHosts.has(hostname)
  return {
    isDeployPreview,
    isBranchDeploy,
    isPreview: isDeployPreview || isBranchDeploy,
  }
}

function logDebugOnce (context) {
  if (loggedDebug || !isDebugOverlayEnabled()) return
  loggedDebug = true
  try {
    console.info('[deploy-context]', context)
  } catch {}
}

export function getDeployContext () {
  const hostname = readHostname()
  const envContext = readEnvContext()
  const prodHosts = new Set([
    ...DEFAULT_PROD_HOSTS,
    ...readEnvProdHosts(),
  ])
  const previewFromHost = computePreviewFromHostname(hostname, prodHosts)
  const isKnownProdHost = prodHosts.has(hostname)

  let resolvedContext = 'production'
  if (isKnownProdHost) {
    resolvedContext = 'production'
  } else if (envContext) {
    resolvedContext = envContext
  } else if (previewFromHost.isDeployPreview) {
    resolvedContext = 'deploy-preview'
  } else if (previewFromHost.isBranchDeploy) {
    resolvedContext = 'branch-deploy'
  }

  const isPreview = PREVIEW_CONTEXTS.has(resolvedContext)
  const isProduction = resolvedContext === 'production'
  const writesAllowed = isProduction

  const details = {
    context: resolvedContext,
    envContext,
    hostname,
    prodHosts: [...prodHosts],
    isDeployPreview: previewFromHost.isDeployPreview,
    isBranchDeploy: previewFromHost.isBranchDeploy,
    isPreview,
    isProduction,
    writesAllowed,
  }

  logDebugOnce(details)
  return details
}

export function isWritesAllowed () {
  return getDeployContext().writesAllowed
}

export function getPreviewWriteDisabledMessage () {
  return 'Writes er slået fra i deploy preview (deploy-preview/branch deploy). Åbn production-linket for at kunne dele.'
}
