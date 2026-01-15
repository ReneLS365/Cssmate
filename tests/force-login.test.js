import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

function createSessionStorage() {
  const store = new Map()
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null
    },
    setItem(key, value) {
      store.set(key, String(value))
    },
    removeItem(key) {
      store.delete(key)
    },
    dump() {
      return new Map(store)
    },
  }
}

function setWindowForTest({ search = '', pathname = '/' } = {}) {
  globalThis.window = {
    location: {
      search,
      pathname,
    },
    sessionStorage: createSessionStorage(),
  }
  globalThis.sessionStorage = globalThis.window.sessionStorage
}

test('forceLoginOnce attempts auto-login once per session when unauthenticated', async t => {
  const originalWindow = globalThis.window
  const originalSessionStorage = globalThis.sessionStorage

  setWindowForTest()

  const { forceLoginOnce, setForceLoginDependencies, resetForceLoginDependencies } = await import('../src/auth/force-login.js')

  t.after(() => {
    resetForceLoginDependencies()
    mock.restoreAll()
    globalThis.window = originalWindow
    if (originalWindow === undefined) delete globalThis.window
    globalThis.sessionStorage = originalSessionStorage
    if (originalSessionStorage === undefined) delete globalThis.sessionStorage
  })

  const initAuth0Mock = mock.fn(async () => {})
  const isAuthenticatedMock = mock.fn(async () => false)
  const loginMock = mock.fn(async () => {})
  const overlayMock = mock.fn(() => {})
  const watchMock = mock.fn(() => {})

  setForceLoginDependencies({
    auth: {
      initAuth0: initAuth0Mock,
      isAuthenticated: isAuthenticatedMock,
      login: loginMock,
    },
    overlay: {
      showLoginOverlay: overlayMock,
      startLoginOverlayWatcher: watchMock,
      hideLoginOverlay: mock.fn(() => {}),
    },
  })

  await forceLoginOnce()
  await forceLoginOnce()

  assert.equal(initAuth0Mock.mock.calls.length, 2, 'initAuth0 called each run')
  assert.equal(isAuthenticatedMock.mock.calls.length, 2, 'auth check runs')
  assert.equal(loginMock.mock.calls.length, 1, 'login only triggered once')
  assert.equal(overlayMock.mock.calls.length, 1, 'overlay shown after guard hit')
  assert.equal(watchMock.mock.calls.length, 1, 'overlay watcher started once')
})

test('forceLoginOnce clears guard when authenticated', async t => {
  const originalWindow = globalThis.window
  const originalSessionStorage = globalThis.sessionStorage

  setWindowForTest()
  globalThis.window.sessionStorage.setItem('cssmate_autologin_attempted', '1')

  const { forceLoginOnce, setForceLoginDependencies, resetForceLoginDependencies } = await import('../src/auth/force-login.js')

  t.after(() => {
    resetForceLoginDependencies()
    mock.restoreAll()
    globalThis.window = originalWindow
    if (originalWindow === undefined) delete globalThis.window
    globalThis.sessionStorage = originalSessionStorage
    if (originalSessionStorage === undefined) delete globalThis.sessionStorage
  })

  const initAuth0Mock = mock.fn(async () => {})
  const isAuthenticatedMock = mock.fn(async () => true)
  const loginMock = mock.fn(async () => {})

  setForceLoginDependencies({
    auth: {
      initAuth0: initAuth0Mock,
      isAuthenticated: isAuthenticatedMock,
      login: loginMock,
    },
    overlay: {
      showLoginOverlay: mock.fn(() => {}),
      startLoginOverlayWatcher: mock.fn(() => {}),
      hideLoginOverlay: mock.fn(() => {}),
    },
  })

  await forceLoginOnce()

  assert.equal(initAuth0Mock.mock.calls.length, 1, 'initAuth0 called')
  assert.equal(isAuthenticatedMock.mock.calls.length, 1, 'auth check runs')
  assert.equal(loginMock.mock.calls.length, 0, 'login not triggered when authenticated')
  assert.equal(
    globalThis.window.sessionStorage.getItem('cssmate_autologin_attempted'),
    null,
    'guard removed after authentication'
  )
})

test('forceLoginOnce skips callback URLs', async t => {
  const originalWindow = globalThis.window
  const originalSessionStorage = globalThis.sessionStorage

  setWindowForTest({ search: '?code=abc&state=123', pathname: '/callback' })

  const { forceLoginOnce, setForceLoginDependencies, resetForceLoginDependencies } = await import('../src/auth/force-login.js')

  t.after(() => {
    resetForceLoginDependencies()
    mock.restoreAll()
    globalThis.window = originalWindow
    if (originalWindow === undefined) delete globalThis.window
    globalThis.sessionStorage = originalSessionStorage
    if (originalSessionStorage === undefined) delete globalThis.sessionStorage
  })

  const initAuth0Mock = mock.fn(async () => {})
  const isAuthenticatedMock = mock.fn(async () => false)
  const loginMock = mock.fn(async () => {})
  const hideOverlayMock = mock.fn(() => {})

  setForceLoginDependencies({
    auth: {
      initAuth0: initAuth0Mock,
      isAuthenticated: isAuthenticatedMock,
      login: loginMock,
    },
    overlay: {
      showLoginOverlay: mock.fn(() => {}),
      startLoginOverlayWatcher: mock.fn(() => {}),
      hideLoginOverlay: hideOverlayMock,
    },
  })

  await forceLoginOnce()

  assert.equal(initAuth0Mock.mock.calls.length, 0, 'initAuth0 not called on callback')
  assert.equal(isAuthenticatedMock.mock.calls.length, 0, 'auth check not called on callback')
  assert.equal(loginMock.mock.calls.length, 0, 'login not called on callback')
  assert.equal(hideOverlayMock.mock.calls.length, 1, 'overlay cleared on callback')
})
