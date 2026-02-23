import { expect, test, type Page } from '@playwright/test'

async function openAdminTab(page: Page, tabId: string, mobileLabel: string) {
  const desktopTab = page.locator(`[role="tab"][data-tab-id="${tabId}"]`)
  if (await desktopTab.count()) {
    const visible = await desktopTab.first().isVisible().catch(() => false)
    if (visible) {
      await desktopTab.first().click()
      return
    }
  }

  const combo = page.getByRole('combobox', { name: /vælg fane/i })
  await expect(combo).toBeVisible()
  await combo.selectOption({ label: mobileLabel })
}

test('tab navigation works when loading /admin route', async ({ page }) => {
  await page.addInitScript(() => {
    window.VITE_E2E_BYPASS_AUTH = '1'
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/admin?skipAuthGate=1', { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle')

  await openAdminTab(page, 'optaelling', 'Optælling')
  await expect(page.locator('#panel-optaelling')).toBeVisible()

  await openAdminTab(page, 'lon', 'Løn')
  await expect(page.locator('#panel-lon')).toBeVisible()
  await expect(page.locator('#panel-sagsinfo')).toHaveAttribute('hidden', '')
})
