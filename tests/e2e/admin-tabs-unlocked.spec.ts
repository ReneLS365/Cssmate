import { expect, test } from '@playwright/test'

test('admin route allows tab switching after auth', async ({ page }) => {
  await page.addInitScript(() => {
    window.VITE_E2E_BYPASS_AUTH = '1'
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/admin', { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle')

  const authState = await page.evaluate(() => ({
    htmlClass: document.documentElement.className,
    bodyClass: document.body.className,
    gateHidden: document.getElementById('authGate')?.hasAttribute('hidden'),
  }))
  expect(authState.htmlClass).not.toContain('auth-locked')
  expect(authState.htmlClass).not.toContain('data-locked')
  expect(authState.bodyClass).not.toContain('auth-overlay-open')
  expect(authState.gateHidden).toBeTruthy()

  const hitTest = await page.evaluate(() => {
    const tab = document.querySelector('[role="tab"][data-tab-id="optaelling"]')
    if (!tab) return null
    const rect = tab.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    const topEl = document.elementFromPoint(x, y)
    const resolved = topEl?.closest?.('[role="tab"][data-tab-id]') || topEl
    return {
      tag: resolved?.tagName?.toLowerCase() || '',
      tabId: resolved?.dataset?.tabId || '',
      id: resolved?.id || '',
    }
  })
  expect(hitTest?.tabId || hitTest?.id).toBe('optaelling')

  const optaellingTab = page.locator('[role="tab"][data-tab-id="optaelling"]')
  await expect(optaellingTab).toBeVisible()
  await optaellingTab.click()
  await expect(page.locator('#panel-optaelling')).toBeVisible()

  const lonTab = page.locator('[role="tab"][data-tab-id="lon"]')
  await expect(lonTab).toBeVisible()
  await lonTab.click()
  await expect(page.locator('#panel-lon')).toBeVisible()

  const teamTab = page.locator('[role="tab"][data-tab-id="team"]')
  await expect(teamTab).toBeVisible()
  await teamTab.click()
  await expect(page.locator('#panel-team')).toBeVisible()
})
