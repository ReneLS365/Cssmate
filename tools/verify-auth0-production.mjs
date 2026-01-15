#!/usr/bin/env node
const requiredKeys = [
  'VITE_AUTH0_DOMAIN',
  'VITE_AUTH0_CLIENT_ID',
  'VITE_AUTH0_REDIRECT_URI',
]

const isProduction = process.env.NODE_ENV === 'production' || process.env.CONTEXT === 'production'

function readEnv(key) {
  const value = process.env[key]
  if (value == null) return ''
  return String(value).trim()
}

function isPlaceholder(value) {
  if (!value) return true
  const normalized = value.toLowerCase()
  return (
    normalized.includes('example')
    || normalized.includes('changeme')
    || normalized.includes('your-')
    || normalized.includes('your_')
    || normalized.includes('xxx')
    || normalized.includes('todo')
  )
}

function fail(message) {
  console.error(`[auth0:preflight] ${message}`)
  process.exit(1)
}

if (!isProduction) {
  process.exit(0)
}

requiredKeys.forEach(key => {
  const value = readEnv(key)
  if (!value) {
    fail(`${key} mangler. Sæt værdien i Netlify environment variables (production).`)
  }
})

const domain = readEnv('VITE_AUTH0_DOMAIN')
if (domain.startsWith('dev-')) {
  fail('VITE_AUTH0_DOMAIN må ikke starte med "dev-" for production builds.')
}

if (isPlaceholder(domain)) {
  fail('VITE_AUTH0_DOMAIN ser ud til at være en placeholder. Sæt den rigtige Auth0 tenant domain i Netlify.')
}

const clientId = readEnv('VITE_AUTH0_CLIENT_ID')
if (isPlaceholder(clientId)) {
  fail('VITE_AUTH0_CLIENT_ID ser ud til at være en placeholder. Sæt den rigtige client id i Netlify.')
}

const redirectUri = readEnv('VITE_AUTH0_REDIRECT_URI')
if (isPlaceholder(redirectUri)) {
  fail('VITE_AUTH0_REDIRECT_URI ser ud til at være en placeholder. Sæt den rigtige redirect URI i Netlify.')
}

if (readEnv('VITE_E2E_BYPASS_AUTH')) {
  fail('VITE_E2E_BYPASS_AUTH må ikke være sat for production builds.')
}
