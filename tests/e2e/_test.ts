import { test as base, expect } from '@playwright/test'

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      // @ts-ignore
      window.VITE_E2E_BYPASS_AUTH = '1'
      // @ts-ignore
      window.VITE_E2E = '1'
    })

    await use(page)
  }
})

export { expect }
