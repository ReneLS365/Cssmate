import { getDeployContext, isProd } from './_context.mjs'
import { getPoolRaw, isDbReady } from './_db.mjs'

function parseHostList (value) {
  if (!value) return new Set()
  return new Set(
    String(value)
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  )
}

function resolveDatabaseHost (databaseUrl) {
  try {
    const url = new URL(databaseUrl)
    return url.hostname.toLowerCase()
  } catch {
    return ''
  }
}

export function getDbConfigStatus () {
  const configured = Boolean(process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED)
  const missingKeys = [
    'DATABASE_URL',
    'DATABASE_URL_UNPOOLED',
  ].filter((key) => !process.env[key])
  return { configured, missingKeys }
}

export function collectDriftWarnings () {
  const warnings = []
  if (!process.env.APP_ORIGIN) warnings.push('APP_ORIGIN mangler.')
  if (!process.env.AUTH0_DOMAIN) warnings.push('AUTH0_DOMAIN mangler.')
  if (!process.env.AUTH0_AUDIENCE) warnings.push('AUTH0_AUDIENCE mangler.')
  if (!process.env.AUTH0_ISSUER) warnings.push('AUTH0_ISSUER mangler.')

  if (isProd() && process.env.DATABASE_PROD_HOSTS) {
    const allowlist = parseHostList(process.env.DATABASE_PROD_HOSTS)
    const databaseUrl = process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || ''
    const host = resolveDatabaseHost(databaseUrl)
    if (host && allowlist.size && !allowlist.has(host)) {
      warnings.push(`DATABASE_URL host (${host}) matcher ikke DATABASE_PROD_HOSTS.`)
    }
  }

  return warnings
}

export async function runDeepHealthChecks () {
  const dbStatus = {
    configured: false,
    select1Ok: false,
    ready: false,
    latencyMs: null,
  }
  const warnings = []
  const config = getDbConfigStatus()
  dbStatus.configured = config.configured

  if (!dbStatus.configured) {
    warnings.push('Database ikke konfigureret.')
    return {
      ok: false,
      db: dbStatus,
      warnings,
      deployContext: getDeployContext(),
    }
  }

  try {
    const pool = await getPoolRaw()
    const started = Date.now()
    await pool.query('SELECT 1')
    dbStatus.select1Ok = true
    dbStatus.latencyMs = Math.max(0, Date.now() - started)
    dbStatus.ready = await isDbReady()
  } catch (error) {
    warnings.push('Database check fejlede.')
  }

  return {
    ok: Boolean(dbStatus.select1Ok && dbStatus.ready),
    db: dbStatus,
    warnings,
    deployContext: getDeployContext(),
  }
}
