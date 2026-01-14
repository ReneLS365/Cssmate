import { expect, test } from '@playwright/test'

test('admin route allows tab switching after auth', async ({ page }) => {
  await page.addInitScript(() => {
    window.VITE_E2E_BYPASS_AUTH = '1'
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/admin', { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle')

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
