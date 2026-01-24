import { BUILD_CONTEXT } from '../version.js'
import { isDebugOverlayEnabled } from '../state/debug.js'

const PROD_HOSTS = new Set(['sscaff.netlify.app'])
const PREVIEW_CONTEXTS = new Set(['deploy-preview', 'branch-deploy'])

let loggedDebug = false

function sanitizeEnvContext (value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return ''
  if (normalized.includes('${') || normalized.includes('}')) return ''
  if (normalized === 'undefined' || normalized === 'null') return ''
  return normalized
}

function readEnvContext () {
  const metaEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}
  const embeddedEnv = typeof window !== 'undefined' ? (window.__ENV__ || {}) : {}
  const context = metaEnv.VITE_NETLIFY_CONTEXT
    || metaEnv.CONTEXT
    || metaEnv.NETLIFY_CONTEXT
    || embeddedEnv.VITE_NETLIFY_CONTEXT
    || embeddedEnv.CONTEXT
    || embeddedEnv.NETLIFY_CONTEXT
    || BUILD_CONTEXT
    || ''
  return sanitizeEnvContext(context)
}

function readHostname () {
  if (typeof window === 'undefined') return ''
  return String(window.location?.hostname || '').trim().toLowerCase()
}

function computePreviewFromHostname (hostname) {
  if (!hostname) return { isDeployPreview: false, isBranchDeploy: false, isPreview: false }
  const isDeployPreview = hostname.startsWith('deploy-preview-')
  const isBranchDeploy = hostname.includes('--')
    && hostname.endsWith('.netlify.app')
    && !PROD_HOSTS.has(hostname)
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
  const previewFromHost = computePreviewFromHostname(hostname)
  const isKnownProdHost = PROD_HOSTS.has(hostname)

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
