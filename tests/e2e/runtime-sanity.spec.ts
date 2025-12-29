import { test, expect } from '@playwright/test'
import { createConsoleCollector } from './helpers/console-collector'

test('runtime sanity check', async ({ page }, testInfo) => {
  const collector = createConsoleCollector(page)
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  const responseErrors: string[] = []

  page.on('pageerror', error => {
    pageErrors.push(error?.message || String(error))
  })

  page.on('console', message => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
    }
  })

  page.on('response', response => {
    const status = response.status()
    if (status < 400) return
    const request = response.request()
    const resourceType = request.resourceType()
    const url = response.url()
    const isCriticalType = resourceType === 'document' || resourceType === 'script' || resourceType === 'stylesheet'
    const isCriticalExtension = /\.(?:html?|js|css)(?:\?|$)/i.test(url)
    if (isCriticalType || isCriticalExtension) {
      responseErrors.push(`${status} ${resourceType} ${url}`)
    }
  })

  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle')

    expect(pageErrors, `Page errors: ${pageErrors.join(' | ')}`).toEqual([])
    expect(consoleErrors, `Console errors: ${consoleErrors.join(' | ')}`).toEqual([])
    expect(responseErrors, `Critical response errors: ${responseErrors.join(' | ')}`).toEqual([])
  } finally {
    await collector.attachIfFailed(testInfo)
  }
})
