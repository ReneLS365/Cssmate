const requiredEnv = []

const missing = requiredEnv.filter((name) => !process.env[name])

if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`)
  process.exit(1)
}

const nodeEnv = process.env.NODE_ENV || 'development'
console.log(`Environment check passed. NODE_ENV=${nodeEnv}`)
