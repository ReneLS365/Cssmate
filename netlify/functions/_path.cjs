const path = require('node:path')

/**
 * Netlify bundles functions to /var/task/netlify/functions/<name>.js
 * __dirname at runtime points to /var/task/netlify/functions
 */
function resolveFromFunctionsDir (...parts) {
  return path.join(__dirname, ...parts)
}

module.exports = { resolveFromFunctionsDir }
