import { expect, type Page } from '@playwright/test'

type TabSpec = { id: string; label: string }

export async function gotoApp(page: Page, opts?: { tabId?: string }) {
  const query = opts?.tabId
    ? `?tab=${encodeURIComponent(opts.tabId)}&skipAuthGate=1`
    : '?skipAuthGate=1'
  await page.goto(`/${query}`, { waitUntil: 'domcontentloaded' })
}

/**
 * Switch tab in a viewport-agnostic way:
 * - On mobile (<520px) tabs are hidden and #tabSelect is used.
 * - On desktop tabs are visible and role="tab" can be clicked.
 */
export async function openTab(page: Page, tab: TabSpec) {
  const select = page.locator('#tabSelect')

  if (await select.count()) {
    if (await select.isVisible()) {
      await select.selectOption({ value: tab.id }).catch(async () => {
        await select.selectOption({ label: tab.label })
      })
    } else {
      const button = page.getByRole('tab', { name: tab.label })
      await expect(button).toBeVisible()
      await button.click()
    }
  } else {
    const button = page.getByRole('tab', { name: tab.label })
    await expect(button).toBeVisible()
    await button.click()
  }

  await expect(page.locator(`#panel-${tab.id}`)).toBeVisible()
}
