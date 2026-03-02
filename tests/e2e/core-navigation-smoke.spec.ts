import { test, expect } from './_test'
import { createConsoleCollector } from './helpers/console-collector'
import { gotoApp, openTab } from './helpers/tab-nav'

const coreTabs = [
  { id: 'delte-sager', label: 'Delt sager' },
  { id: 'optaelling', label: 'Optælling' },
  { id: 'lon', label: 'Løn' },
  { id: 'sagsinfo', label: 'Sagsinfo' },
  { id: 'historik', label: 'Historik' },
  { id: 'team', label: 'Team' },
  { id: 'hjaelp', label: 'Hjælp' },
]

test('core navigation smoke: app loads and tabs are reachable without fatal errors', async ({ page }, testInfo) => {
  const collector = createConsoleCollector(page)
  const pageErrors: string[] = []
  const fatalConsoleErrors: string[] = []

  page.on('pageerror', error => {
    pageErrors.push(error?.message || String(error))
  })

  page.on('console', message => {
    if (message.type() === 'error') {
      fatalConsoleErrors.push(message.text())
    }
  })

  try {
    await gotoApp(page, { tabId: 'delte-sager' })
    await page.waitForLoadState('networkidle')

    for (const tab of coreTabs) {
      await expect(page.locator(`[data-tab-id="${tab.id}"]`)).toHaveCount(1)
      await openTab(page, tab)
      await expect(page.locator(`#panel-${tab.id}`)).toBeVisible()
    }

    expect(pageErrors, `Page errors: ${pageErrors.join(' | ')}`).toEqual([])
    expect(fatalConsoleErrors, `Console errors: ${fatalConsoleErrors.join(' | ')}`).toEqual([])
  } finally {
    await collector.attachIfFailed(testInfo)
  }
})
