import type { Page, TestInfo } from '@playwright/test'

export function createConsoleCollector(page: Page) {
  const entries: string[] = []

  page.on('pageerror', error => {
    entries.push(`[pageerror] ${error?.message || String(error)}`)
  })

  page.on('console', message => {
    const type = message.type()
    if (type === 'error' || type === 'warning') {
      entries.push(`[console:${type}] ${message.text()}`)
    }
  })

  return {
    entries,
    async attachIfFailed(testInfo: TestInfo) {
      if (testInfo.status === testInfo.expectedStatus) return
      if (!entries.length) return
      await testInfo.attach('console-log', {
        body: entries.join('\n'),
        contentType: 'text/plain',
      })
    },
  }
}
