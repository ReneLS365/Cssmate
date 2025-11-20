const JOB_CHANGE_EVENT = 'csmate:active-job-change'

let activeJob = null

function notifySubscribers () {
  if (typeof document === 'undefined' || typeof CustomEvent !== 'function') return
  const detail = { job: activeJob }
  document.dispatchEvent(new CustomEvent(JOB_CHANGE_EVENT, { detail }))
}

export function getActiveJob () {
  return activeJob
}

export function setActiveJob (job) {
  activeJob = job ? { ...job } : null
  notifySubscribers()
  return activeJob
}

export function clearActiveJob () {
  activeJob = null
  notifySubscribers()
}

export function subscribeToJobChanges (callback) {
  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return () => {}
  if (typeof callback !== 'function') return () => {}
  const handler = event => callback(event.detail?.job ?? null)
  document.addEventListener(JOB_CHANGE_EVENT, handler)
  return () => document.removeEventListener(JOB_CHANGE_EVENT, handler)
}

export function getJobChangeEventName () {
  return JOB_CHANGE_EVENT
}
