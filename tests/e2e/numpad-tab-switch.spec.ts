import { test, expect } from '@playwright/test'

test('numpad closes on tab switch', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle')

  const lonTab = page.locator('[role="tab"][data-tab-id="lon"]')
  await expect(lonTab).toBeVisible()
  await lonTab.click()

  const kmInput = page.locator('#km')
  await expect(kmInput).toBeVisible()
  await kmInput.click()

  const overlay = page.locator('#numpad-overlay')
  await expect(overlay).toBeVisible()
  await expect(overlay).toHaveAttribute('aria-hidden', 'false')

  const sagsinfoTab = page.locator('[role="tab"][data-tab-id="sagsinfo"]')
  await expect(sagsinfoTab).toBeVisible()
  await sagsinfoTab.click()

  await expect(overlay).toHaveAttribute('hidden', '')
  await expect(overlay).toHaveClass(/numpad-hidden/)
})
