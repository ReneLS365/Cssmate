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

  if (await select.count()) {
    await page.waitForFunction(() => {
      const el = document.getElementById('tabSelect') as HTMLSelectElement | null
      return Boolean(el && el.options && el.options.length > 0)
    })

    await select.selectOption({ label: tabSpec.label }).catch(async () => {
      await select.selectOption({ value: tabSpec.id })
    })
  } else {
    const button = page.getByRole('tab', { name: tabSpec.label })
    await expect(button).toBeVisible()
    await button.click()
  }

  await expect(page.locator(`#panel-${tabSpec.id}`)).toBeVisible()
}
