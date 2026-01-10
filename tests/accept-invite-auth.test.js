import assert from 'node:assert/strict'
import test from 'node:test'

const PENDING_INVITE_KEY = 'cssmate:pendingInvite'

function createStorage () {
  const store = new Map()
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, String(value))
    },
    removeItem: (key) => {
      store.delete(key)
    },
  }
}

test('acceptInvite clears token and shows login on 401', async () => {
  const originalWindow = globalThis.window
  const originalDocument = globalThis.document
  const originalFetch = globalThis.fetch

  const storage = createStorage()
  const statusEl = { textContent: '', dataset: {} }
  const loginButton = { hidden: true, addEventListener: () => {} }
  const retryButton = { hidden: true, addEventListener: () => {} }

  globalThis.window = {
    localStorage: storage,
    location: {
      search: '',
      href: '',
    },
  }
  globalThis.document = {
    getElementById: (id) => {
      if (id === 'inviteStatus') return statusEl
      if (id === 'inviteLogin') return loginButton
      if (id === 'inviteRetry') return retryButton
      return null
    },
  }
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    statusText: 'Unauthorized',
    text: async () => 'Unauthorized',
  })

  try {
    const { acceptInvite, PENDING_INVITE_KEY: exportedKey } = await import('../js/accept-invite.js')
    assert.equal(exportedKey, PENDING_INVITE_KEY)
    loginButton.hidden = true

    await acceptInvite('invite-1', 'token-1')

    const stored = storage.getItem(PENDING_INVITE_KEY)
    assert.ok(stored)
    assert.equal(loginButton.hidden, false)
    assert.ok(statusEl.textContent.includes('Sessionen er udløbet'))
  } finally {
    globalThis.window = originalWindow
    if (originalWindow === undefined) delete globalThis.window
    globalThis.document = originalDocument
    if (originalDocument === undefined) delete globalThis.document
    globalThis.fetch = originalFetch
    if (originalFetch === undefined) delete globalThis.fetch
  }
})
