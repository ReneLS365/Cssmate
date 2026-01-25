function normalize (v) {
  return String(v || '').trim()
}

function hostnameFromUrl (u) {
  try {
    return new URL(u).hostname
  } catch {
    return ''
  }
}

function isString (v) {
  return typeof v === 'string' && v.trim().length > 0
}

function isPreviewHostname (hostname) {
  return hostname.includes('deploy-preview-') || hostname.includes('branch-') || hostname.includes('--')
}

function isPlainNetlifyAppHost (hostname) {
  if (!hostname.endsWith('.netlify.app')) return false
  return !isPreviewHostname(hostname)
}

export function getDeployContext () {
  const ctx = normalize(
    process.env.CONTEXT ||
      process.env.NETLIFY_CONTEXT ||
      process.env.VITE_NETLIFY_CONTEXT ||
      process.env.NETLIFY_DEPLOY_CONTEXT
  ).toLowerCase()
  if (isString(ctx)) {
    if (ctx === 'production') return 'production'
    if (ctx === 'deploy-preview' || ctx === 'branch-deploy' || ctx === 'preview') return 'preview'
  }

  const url = normalize(process.env.URL)
  const deployUrl = normalize(process.env.DEPLOY_URL)
  const primeUrl = normalize(process.env.DEPLOY_PRIME_URL)

  const hUrl = hostnameFromUrl(url)
  const hDeploy = hostnameFromUrl(deployUrl)
  const hPrime = hostnameFromUrl(primeUrl)

  // Netlify preview patterns on subdomains:
  // - deploy-preview-123--site.netlify.app
  // - branch-something--site.netlify.app
  // - *--site.netlify.app (double-dash is a strong signal)
  // If clearly preview/branch hostname → preview
  if (isPreviewHostname(hDeploy) || isPreviewHostname(hPrime) || isPreviewHostname(hUrl)) return 'preview'

  // If deploy hostname equals the primary site hostname → production
  if (hUrl && hDeploy && hUrl === hDeploy) return 'production'

  // IMPORTANT FIX:
  // Netlify Functions sometimes has URL set but DEPLOY_URL / DEPLOY_PRIME_URL missing.
  // When URL is a non-preview host, treat it as production.
  if (hUrl && !hDeploy && !hPrime) return 'production'

  if (isPlainNetlifyAppHost(hUrl)) return 'production'

  return 'unknown'
}

export function isProd () {
  const ctx = getDeployContext()
  if (ctx === 'production') return true
  const urlHost = hostnameFromUrl(normalize(process.env.URL))
  return isPlainNetlifyAppHost(urlHost)
}

export function isPreview () {
  return getDeployContext() === 'preview'
}
