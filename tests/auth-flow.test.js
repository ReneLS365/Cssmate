import assert from 'node:assert/strict'
import test, { before } from 'node:test'
import { chromium } from 'playwright'

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
