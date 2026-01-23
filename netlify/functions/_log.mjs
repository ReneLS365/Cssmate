const REDACTED = '[REDACTED]'

function redactAuth (value) {
  return value
    .replace(/(authorization:\s*bearer\s+)[^\s]+/gi, `$1${REDACTED}`)
    .replace(/(bearer\s+)[a-z0-9\-_.=]+/gi, `$1${REDACTED}`)
}

function redactCookies (value) {
  return value
    .replace(/(cookie:\s*)[^\n]+/gi, `$1${REDACTED}`)
    .replace(/(set-cookie:\s*)[^\n]+/gi, `$1${REDACTED}`)
}

function redactDatabaseUrls (value) {
  let output = value.replace(
    /(postgres(?:ql)?:\/\/)([^@\s]+@)/gi,
    `$1${REDACTED}@`
  )
  output = output.replace(/(DATABASE_URL[^=\s]*=)[^\s]+/gi, `$1${REDACTED}`)
  output = output.replace(/(NETLIFY_DATABASE_URL[^=\s]*=)[^\s]+/gi, `$1${REDACTED}`)
  return output
}

export function sanitizeString (value) {
  if (value === null || value === undefined) return ''
  let output = String(value)
  output = redactAuth(output)
  output = redactCookies(output)
  output = redactDatabaseUrls(output)
  return output
}

export function sanitizeObject (value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return sanitizeString(value)
  if (typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  if (Array.isArray(value)) {
    return value.map(entry => sanitizeObject(entry, seen))
  }
  const output = {}
  for (const [key, entry] of Object.entries(value)) {
    output[key] = sanitizeObject(entry, seen)
  }
  return output
}

export function safeError (error) {
  if (!error) return { name: 'Error', message: 'Ukendt fejl' }
  const name = sanitizeString(error.name || 'Error')
  const message = sanitizeString(error.message || 'Ukendt fejl')
  const code = error.code ? sanitizeString(error.code) : undefined
  let stack = ''
  if (error.stack) {
    const trimmed = String(error.stack).split('\n').slice(0, 6).join('\n')
    stack = sanitizeString(trimmed)
  }
  return {
    name,
    message,
    ...(code ? { code } : {}),
    ...(stack ? { stack } : {}),
  }
}
