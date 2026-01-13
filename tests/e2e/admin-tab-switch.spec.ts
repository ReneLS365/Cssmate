import { expect, test } from '@playwright/test'

test('tab navigation works when loading /admin route', async ({ page }) => {
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
  await expect(page.locator('#panel-sagsinfo')).toHaveAttribute('hidden', '')
})
