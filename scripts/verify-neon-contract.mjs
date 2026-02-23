import process from 'node:process'

function parseHosts(csv) {
  return new Set(String(csv || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean))
}

function getHostFromDbUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function main() {
  const context = String(process.env.CONTEXT || process.env.NETLIFY_CONTEXT || 'unknown').toLowerCase()
  const isProd = context === 'production'
  const dbUrl = process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || ''
  const host = getHostFromDbUrl(dbUrl)

  if (!dbUrl || !host) {
    console.error('[neon-contract] FAIL: DATABASE_URL/UNPOOLED missing or invalid')
    process.exit(1)
  }

  const prodHosts = parseHosts(process.env.DATABASE_PROD_HOSTS || '')

  if (!isProd && prodHosts.size > 0 && prodHosts.has(host)) {
    console.error(`[neon-contract] FAIL: Non-prod context "${context}" is pointing at production DB host "${host}".`)
    process.exit(1)
  }

  console.log(`[neon-contract] OK (context=${context}, host=${host})`)
}

main()
