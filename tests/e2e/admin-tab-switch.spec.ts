import { expect, test } from '@playwright/test'
import { openTab } from './helpers/tab-nav'

test('tab navigation works when loading /admin route', async ({ page }) => {
  await page.addInitScript(() => {
    window.VITE_E2E_BYPASS_AUTH = '1'
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/admin?skipAuthGate=1', { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle')

  await openTab(page, { id: 'optaelling', label: 'Optælling' })
  await expect(page.locator('#panel-optaelling')).toBeVisible()

  await openTab(page, { id: 'lon', label: 'Løn' })
  await expect(page.locator('#panel-lon')).toBeVisible()
  await expect(page.locator('#panel-sagsinfo')).toHaveAttribute('hidden', '')
})
