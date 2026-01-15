import assert from 'node:assert/strict'
import test, { before, mock } from 'node:test'
import { chromium } from 'playwright'

import { SESSION_STATUS } from '../src/auth/session.js'
import { __test__ as authGateTest } from '../src/auth/auth-gate.js'
import { login, __test__ as auth0ClientTest } from '../src/auth/auth0-client.js'

const BASE_URL = process.env.AUTH_FLOW_BASE_URL || 'https://sscaff.netlify.app'
const LOGIN_USER = process.env.AUTH0_E2E_USERNAME || ''
const LOGIN_PASS = process.env.AUTH0_E2E_PASSWORD || ''
let canLaunch = true
let launchError = null

before(async () => {
  try {
    const browser = await chromium.launch()
    await browser.close()
  } catch (error) {
    canLaunch = false
    launchError = error
  }
})

async function openPage(url) {
  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(url, { waitUntil: 'networkidle' })
  return { browser, context, page }
}

async function assertAuthGateVisible(page) {
  const gate = page.locator('#authGate')
  await gate.waitFor({ state: 'visible', timeout: 15000 })
  const text = await gate.textContent()
  assert.ok(text?.includes('Log ind'))
}

class MockClassList {
  constructor() {
    this.entries = new Set()
  }

  add(...tokens) {
    tokens.forEach(token => this.entries.add(token))
  }

  remove(...tokens) {
    tokens.forEach(token => this.entries.delete(token))
  }

  contains(token) {
    return this.entries.has(token)
  }

  toggle(token, force) {
    if (typeof force === 'boolean') {
      if (force) this.entries.add(token)
      else this.entries.delete(token)
      return force
    }
    if (this.entries.has(token)) {
      this.entries.delete(token)
      return false
    }
    this.entries.add(token)
    return true
  }
}

class MockElement {
  constructor(id = '') {
    this.id = id
    this.attributes = new Map()
    this.dataset = {}
    this.classList = new MockClassList()
    this.listeners = new Map()
    this.textContent = ''
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value ?? ''))
  }

  removeAttribute(name) {
    this.attributes.delete(name)
  }

  hasAttribute(name) {
    return this.attributes.has(name)
  }

  toggleAttribute(name, force) {
    const shouldSet = typeof force === 'boolean' ? force : !this.attributes.has(name)
    if (shouldSet) {
      this.attributes.set(name, '')
      return true
    }
    this.attributes.delete(name)
    return false
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type).push(handler)
  }
}

function setupAuthGateFixture() {
  const gate = new MockElement('authGate')
  const loadingScreen = new MockElement('authLoadingScreen')
  const loginScreen = new MockElement('authLoginScreen')
  const verifyScreen = new MockElement('authVerifyScreen')
  const messageEl = new MockElement('authMessage')
  const loginButton = new MockElement('authLogin')
  const logoutButton = new MockElement('authLogout')
  const repairButton = new MockElement('authRepair')
  const body = new MockElement('body')
  const documentElement = new MockElement('html')
  const elements = new Map([
    ['authGate', gate],
    ['authLoadingScreen', loadingScreen],
    ['authLoginScreen', loginScreen],
    ['authVerifyScreen', verifyScreen],
    ['authMessage', messageEl],
    ['authLogin', loginButton],
    ['authLogout', logoutButton],
    ['authRepair', repairButton],
  ])

  const mockDocument = {
    body,
    documentElement,
    getElementById: (id) => elements.get(id) || null,
  }

  return {
    mockDocument,
    elements: {
      gate,
      loadingScreen,
      loginScreen,
      verifyScreen,
      messageEl,
      loginButton,
      logoutButton,
      repairButton,
      body,
      documentElement,
    },
  }
}

test('unauthenticated users sees login overlay', { timeout: 120000 }, async (t) => {
  if (!canLaunch) {
    t.skip(`Playwright browser not available: ${launchError?.message || 'unknown error'}`)
    return
  }
  const { browser, page } = await openPage(BASE_URL)
  try {
    await assertAuthGateVisible(page)
  } finally {
    await browser.close()
  }
})

test('skipAuthGate param does not bypass login overlay', { timeout: 120000 }, async (t) => {
  if (!canLaunch) {
    t.skip(`Playwright browser not available: ${launchError?.message || 'unknown error'}`)
    return
  }
  const url = new URL(BASE_URL)
  url.searchParams.set('skipAuthGate', '1')
  const { browser, page } = await openPage(url.toString())
  try {
    await assertAuthGateVisible(page)
  } finally {
    await browser.close()
  }
})

test('authenticated users reach app after login', {
  timeout: 120000,
  skip: !(LOGIN_USER && LOGIN_PASS),
}, async (t) => {
  if (!canLaunch) {
    t.skip(`Playwright browser not available: ${launchError?.message || 'unknown error'}`)
    return
  }
  const { browser, page } = await openPage(BASE_URL)
  try {
    await page.locator('#authLogin').click()
    const emailField = page.locator('input[type="email"], input[name="email"]')
    await emailField.waitFor({ state: 'visible', timeout: 30000 })
    await emailField.fill(LOGIN_USER)

    const passwordField = page.locator('input[type="password"], input[name="password"]')
    await passwordField.fill(LOGIN_PASS)

    const submitButton = page.locator('button[type="submit"], button[name="action"]')
    await submitButton.click()

    const panel = page.locator('#panel-sagsinfo')
    await panel.waitFor({ state: 'visible', timeout: 60000 })
    await page.locator('#authGate').waitFor({ state: 'hidden', timeout: 60000 })
  } finally {
    await browser.close()
  }
})

test('auth gate hard cleanup clears overlay locks after auth', () => {
  const originalDocument = globalThis.document
  const { mockDocument, elements } = setupAuthGateFixture()

  try {
    globalThis.document = mockDocument
    authGateTest.setElements({
      gate: elements.gate,
      loadingScreen: elements.loadingScreen,
      loginScreen: elements.loginScreen,
      verifyScreen: elements.verifyScreen,
      messageEl: elements.messageEl,
      loginButton: elements.loginButton,
      logoutButton: elements.logoutButton,
      repairButton: elements.repairButton,
    })

    elements.documentElement.classList.add('auth-locked')
    elements.body.classList.add('auth-overlay-open')
    elements.gate.setAttribute('data-locked', 'true')
    elements.gate.removeAttribute('hidden')

    authGateTest.handleAuthChange({
      status: SESSION_STATUS.MEMBER,
      authReady: true,
      requiresVerification: false,
      user: { uid: 'user-1' },
    })

    assert.equal(elements.documentElement.classList.contains('auth-locked'), false)
    assert.equal(elements.body.classList.contains('auth-overlay-open'), false)
    assert.equal(elements.gate.hasAttribute('hidden'), true)
    assert.equal(elements.gate.hasAttribute('data-locked'), false)
  } finally {
    globalThis.document = originalDocument
    if (originalDocument === undefined) delete globalThis.document
  }
})

function createMockStorage () {
  const store = new Map()
  return {
    getItem (key) {
      return store.has(key) ? store.get(key) : null
    },
    setItem (key, value) {
      store.set(key, String(value))
    },
    removeItem (key) {
      store.delete(key)
    },
  }
}

async function withMockWindow (
  {
    origin = 'http://localhost:5173',
    pathname = '/admin',
    env = {},
  } = {},
  fn
) {
  const storage = createMockStorage()
  globalThis.window = {
    location: { origin, pathname, search: '' },
    localStorage: storage,
    __ENV__: env,
  }
  try {
    return await fn(storage)
  } finally {
    delete globalThis.window
  }
}

test('loginWithRedirect includes configured organization on login', async (t) => {
  const originalWindow = globalThis.window
  const loginWithRedirect = mock.fn(async () => {})

  auth0ClientTest.setClient({ loginWithRedirect })

  t.after(() => {
    auth0ClientTest.resetClient()
    mock.restoreAll()
    globalThis.window = originalWindow
    if (originalWindow === undefined) delete globalThis.window
  })

  await withMockWindow({ pathname: '/admin', env: { VITE_AUTH0_ORG_ID: 'org_123' } }, async () => {
    await login()
  })

  const options = loginWithRedirect.mock.calls[0]?.arguments?.[0]
  assert.equal(options?.authorizationParams?.organization, 'org_123')
})

test('loginWithRedirect fails when org config is missing', async (t) => {
  const originalWindow = globalThis.window
  const loginWithRedirect = mock.fn(async () => {})

  auth0ClientTest.setClient({ loginWithRedirect })

  t.after(() => {
    auth0ClientTest.resetClient()
    mock.restoreAll()
    globalThis.window = originalWindow
    if (originalWindow === undefined) delete globalThis.window
  })

  await withMockWindow({ pathname: '/admin' }, async () => {
    await assert.rejects(async () => {
      await login()
    }, /Auth0 organisation mangler/)
  })

  assert.equal(loginWithRedirect.mock.calls.length, 0)
})
