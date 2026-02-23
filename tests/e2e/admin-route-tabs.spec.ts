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

async function assertTabNavigation(page: Page) {
  const tabIds = ['optaelling', 'lon', 'team', 'hjaelp']
  const tabLabels: Record<string, string> = {
    optaelling: 'Optælling',
    lon: 'Løn',
    team: 'Team',
    hjaelp: 'Hjælp',
  }

  const initialSnapshot = await page.evaluate(() => window.__tabDebug?.snapshot?.())
  expect(initialSnapshot?.tabCount).toBeGreaterThan(0)
  expect(initialSnapshot?.blockers || []).toHaveLength(0)
  expect(initialSnapshot?.pointerEvents?.appRoot).not.toBe('none')
  expect(initialSnapshot?.pointerEvents?.tabBar).not.toBe('none')

  tabIds.forEach(tabId => {
    const tab = initialSnapshot?.tabs?.find(entry => entry.id === tabId)
    expect(tab?.hasClickHandler).toBe(true)
  })

  for (const tabId of tabIds) {
    await openAdminTab(page, tabId, tabLabels[tabId])
    await expect(page.locator(`[data-tab-panel="${tabId}"]`)).toBeVisible()
    const snapshot = await page.evaluate(() => window.__tabDebug?.snapshot?.())
    expect(snapshot?.activeTab).toBe(tabId)
  }
}

test('admin route unlocks tabs with diagnostics', async ({ page }) => {
  await page.addInitScript(() => {
    window.__TAB_DEBUG__ = true
    window.VITE_E2E_BYPASS_AUTH = '1'
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/admin?skipAuthGate=1', { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle')

  await assertTabNavigation(page)
})

test('root route unlocks tabs with diagnostics', async ({ page }) => {
  await page.addInitScript(() => {
    window.__TAB_DEBUG__ = true
    window.VITE_E2E_BYPASS_AUTH = '1'
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?skipAuthGate=1', { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle')

  await assertTabNavigation(page)
})
