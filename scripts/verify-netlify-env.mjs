import process from 'node:process'

function hasPlaceholder(value) {
  const v = String(value || '').trim()
  return /\$\{[^}]+\}/.test(v) || v.toLowerCase() === 'undefined' || v.toLowerCase() === 'null'
}

function requireEnv(keys, { allowEmpty = false } = {}) {
  const missing = []
  const placeholders = []
  for (const key of keys) {
    const value = process.env[key]
    if (!allowEmpty && (!value || !String(value).trim())) missing.push(key)
    if (value && hasPlaceholder(value)) placeholders.push(key)
  }
  return { missing, placeholders }
}

function assertOk(label, result) {
  const { missing, placeholders } = result
  if (!missing.length && !placeholders.length) return
  console.error(`\n[env-check] FAIL: ${label}`)
  if (missing.length) console.error(`  Missing: ${missing.join(', ')}`)
  if (placeholders.length) console.error(`  Placeholders: ${placeholders.join(', ')}`)
  process.exit(1)
}

function main() {
  assertOk('Auth0 client env', requireEnv([
    'VITE_AUTH0_DOMAIN',
    'VITE_AUTH0_CLIENT_ID',
    'VITE_AUTH0_AUDIENCE',
    'VITE_AUTH0_REDIRECT_URI',
  ]))

  assertOk('Database env', requireEnv([
    'DATABASE_URL',
    'DATABASE_URL_UNPOOLED',
  ]))

  const context = String(process.env.CONTEXT || process.env.NETLIFY_CONTEXT || '').toLowerCase()
  const isProd = context === 'production'
  if (isProd) {
    assertOk('Prod safety env', requireEnv([
      'DATABASE_PROD_HOSTS',
      'HEALTHCHECK_TOKEN',
    ]))
  }

  const prodHosts = process.env.VITE_PROD_HOSTS || ''
  if (prodHosts && hasPlaceholder(prodHosts)) {
    console.error('\n[env-check] FAIL: VITE_PROD_HOSTS contains placeholder value')
    process.exit(1)
  }

  console.log('[env-check] OK')
}

main()
