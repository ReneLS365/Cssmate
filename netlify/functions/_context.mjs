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

export function getDeployContext () {
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
  const isPreviewHost = (h) =>
    h.includes('deploy-preview-') || h.includes('branch-') || h.includes('--')

  // If clearly preview/branch hostname → preview
  if (isPreviewHost(hDeploy) || isPreviewHost(hPrime) || isPreviewHost(hUrl)) return 'preview'

  // If deploy hostname equals the primary site hostname → production
  if (hUrl && hDeploy && hUrl === hDeploy) return 'production'

  // IMPORTANT FIX:
  // Netlify Functions sometimes has URL set but DEPLOY_URL / DEPLOY_PRIME_URL missing.
  // When URL is a non-preview host, treat it as production.
  if (hUrl && !hDeploy && !hPrime) return 'production'

  // Fallback to Netlify context vars if present
  const ctx = normalize(
    process.env.CONTEXT ||
      process.env.NETLIFY_CONTEXT ||
      process.env.NETLIFY_DEPLOY_CONTEXT
  ).toLowerCase()

  if (ctx === 'production') return 'production'
  if (ctx === 'deploy-preview' || ctx === 'branch-deploy') return 'preview'

  return 'unknown'
}

export function isProd () {
  return getDeployContext() === 'production'
}

export function isPreview () {
  return getDeployContext() === 'preview'
}
