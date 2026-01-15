import assert from 'node:assert/strict'
import test from 'node:test'

function setWindowForTest({ origin = 'http://localhost:5173', env = {} } = {}) {
  globalThis.window = {
    location: { origin },
    __ENV__: env,
  }
}

test('resolveAuthRedirectUri defaults to /callback on current origin', async t => {
  const originalWindow = globalThis.window

  setWindowForTest({ origin: 'http://localhost:5173' })
  const { resolveAuthRedirectUri } = await import('../src/auth/resolve-base-url.js')

  t.after(() => {
    globalThis.window = originalWindow
    if (originalWindow === undefined) delete globalThis.window
  })

  assert.equal(resolveAuthRedirectUri(), 'http://localhost:5173/callback')
})

test('resolveAuthRedirectUri uses explicit redirect URI when provided', async t => {
  const originalWindow = globalThis.window

  setWindowForTest({
    origin: 'http://localhost:5173',
    env: { VITE_AUTH0_REDIRECT_URI: 'https://sscaff.netlify.app/callback/' },
  })
  const { resolveAuthRedirectUri } = await import('../src/auth/resolve-base-url.js')

  t.after(() => {
    globalThis.window = originalWindow
    if (originalWindow === undefined) delete globalThis.window
  })

  assert.equal(resolveAuthRedirectUri(), 'https://sscaff.netlify.app/callback')
})
