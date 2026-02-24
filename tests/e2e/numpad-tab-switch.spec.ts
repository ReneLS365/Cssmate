import { test, expect } from '@playwright/test'
import { gotoApp, openTab } from './helpers/tab-nav'

const isNumpadDisabled = process.env.VITE_E2E_DISABLE_NUMPAD === '1'

test('numpad/tab behavior is deterministic across tab switch', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await gotoApp(page, { tabId: 'lon' })
  await page.waitForLoadState('networkidle')

  await openTab(page, { id: 'lon', label: 'Løn' })

  const kmInput = page.locator('#km')
  await expect(kmInput).toBeVisible()
  await kmInput.click()

  const overlay = page.locator('#numpad-overlay')

  if (isNumpadDisabled) {
    await expect(overlay).toHaveAttribute('hidden', '')
    await expect(overlay).toHaveClass(/numpad-hidden/)
    await openTab(page, { id: 'sagsinfo', label: 'Sagsinfo' })
    await expect(page.locator('#panel-sagsinfo')).toBeVisible()
    return
  }

  await expect(overlay).toBeVisible()
  await expect(overlay).toHaveAttribute('aria-hidden', 'false')

  await openTab(page, { id: 'sagsinfo', label: 'Sagsinfo' })

  await expect(overlay).toHaveAttribute('hidden', '')
  await expect(overlay).toHaveClass(/numpad-hidden/)
})
