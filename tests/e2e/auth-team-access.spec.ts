import { expect, test } from '@playwright/test'
import { createConsoleCollector } from './helpers/console-collector'

test('team tab opens without infinite spinner in e2e mode', async ({ page }, testInfo) => {
  const collector = createConsoleCollector(page)
  try {
    await page.addInitScript(() => {
      window.CSSMATE_E2E_TEST_MODE = true
    })
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    await page.getByRole('tab', { name: 'Team' }).click()
    const guard = page.locator('#appAccessGuard')
    await expect(guard).toBeHidden({ timeout: 15000 })
    await expect(page.locator('#teamAdminStatus')).not.toContainText('Tjekker', { timeout: 15000 })
  } finally {
    await collector.attachIfFailed(testInfo)
  }
})
