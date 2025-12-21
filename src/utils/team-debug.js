const DEBUG_FLAG_KEY = 'debugTeam'

function isTeamDebugEnabled () {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage?.getItem(DEBUG_FLAG_KEY) === '1'
  } catch {
    return false
  }
}

function teamDebug (label, details = {}) {
  if (!isTeamDebugEnabled()) return
  const safeDetails = details && typeof details === 'object'
    ? Object.fromEntries(
        Object.entries(details).filter(([key]) => !/token|secret|password/i.test(key))
      )
    : details
  try {
    console.info(`[TeamDebug] ${label}`, safeDetails)
  } catch {}
}

export {
  isTeamDebugEnabled,
  teamDebug,
}
