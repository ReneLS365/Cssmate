import { collectDriftWarnings, runDeepHealthChecks } from './_health.mjs'
import { logJson } from './_log.mjs'

export const config = { schedule: '@hourly' }

export async function handler () {
  const warnings = []
  if (!process.env.APP_ORIGIN) warnings.push('APP_ORIGIN mangler.')
  if (!process.env.HEALTHCHECK_TOKEN) warnings.push('HEALTHCHECK_TOKEN mangler.')

  const driftWarnings = collectDriftWarnings().slice(0, 3)

  if (warnings.length) {
    logJson('warn', 'health-ping', {
      event: 'health-ping',
      ok: false,
      dbReady: false,
      latencyMs: null,
      warningsCount: warnings.length,
      driftWarnings,
    })
    return { statusCode: 200, body: '' }
  }

  const result = await runDeepHealthChecks()
  logJson('info', 'health-ping', {
    event: 'health-ping',
    ok: result.ok,
    dbReady: result.db.ready,
    latencyMs: result.db.latencyMs,
    warningsCount: result.warnings.length,
    driftWarnings,
  })
  return { statusCode: 200, body: '' }
}
