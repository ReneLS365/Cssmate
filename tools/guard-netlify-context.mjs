const PLACEHOLDER_PATTERN = /[${}]/u

const valuesToCheck = [
  ['VITE_NETLIFY_CONTEXT', process.env.VITE_NETLIFY_CONTEXT],
  ['CONTEXT', process.env.CONTEXT],
  ['NETLIFY_CONTEXT', process.env.NETLIFY_CONTEXT],
]

const placeholders = valuesToCheck.filter(([, value]) => {
  if (!value) return false
  return PLACEHOLDER_PATTERN.test(value)
})

if (placeholders.length > 0) {
  const details = placeholders
    .map(([key, value]) => `${key}="${value}"`)
    .join(', ')
  console.error(`Invalid Netlify context placeholders detected: ${details}`)
  process.exit(1)
}
