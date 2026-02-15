import { expect, type Page } from '@playwright/test'

type TabSpec = { id: string; label: string }

export async function gotoApp(page: Page, opts?: { tabId?: string }) {
  const query = opts?.tabId
    ? `?tab=${encodeURIComponent(opts.tabId)}&skipAuthGate=1`
    : '?skipAuthGate=1'
  await page.goto(`/${query}`, { waitUntil: 'domcontentloaded' })
}

function toTabSpec(tab: TabSpec | string): TabSpec {
  if (typeof tab === 'string') {
    const id = tab.toLowerCase().replace(/\s+/g, '-')
    return { id, label: tab }
  }
  return tab
}

/**
 * Switch tab in a viewport-agnostic and mobile-safe way.
 */
export async function openTab(page: Page, tab: TabSpec | string) {
  const tabSpec = toTabSpec(tab)
  await page.waitForSelector('html.app-ready', { timeout: 60000 })

  const select = page.locator('#tabSelect')
  const selectExists = (await select.count().catch(() => 0)) > 0

  if (selectExists) {
    await page.waitForFunction(() => {
      const el = document.getElementById('tabSelect') as HTMLSelectElement | null
      return Boolean(el && el.options && el.options.length > 0)
    }, undefined, { timeout: 10000 }).catch(() => {})

    await select.selectOption({ label: tabSpec.label }, { timeout: 10000 }).catch(async () => {
      await select.selectOption({ value: tabSpec.id }, { timeout: 10000 })
    })

    const panel = page.locator(`#panel-${tabSpec.id}`)
    const isPanelVisible = await panel.isVisible().catch(() => false)
    if (!isPanelVisible) {
      const tabButton = page.getByRole('tab', { name: tabSpec.label })
      await expect(tabButton).toBeVisible()
      await tabButton.click()
    }

    await expect(panel).toBeVisible()
    return
  }

  const tabButton = page.getByRole('tab', { name: tabSpec.label })
  await expect(tabButton).toBeVisible()
  await tabButton.click()
  await expect(page.locator(`#panel-${tabSpec.id}`)).toBeVisible()
}
