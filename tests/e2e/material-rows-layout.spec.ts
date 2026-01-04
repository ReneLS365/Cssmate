import { test, expect } from '@playwright/test'

const viewports = [
  { width: 320, height: 740 },
  { width: 360, height: 780 },
  { width: 390, height: 844 },
]

for (const viewport of viewports) {
  test(`material rows stay on one line at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/debug/material-row-debug.html', { waitUntil: 'domcontentloaded' })

    const row = page.locator('.material-row').first()
    await expect(row).toBeVisible()

    const display = await row.evaluate(element => getComputedStyle(element).display)
    expect(display).toBe('grid')

    const nameBox = await row.locator('.mat-name').boundingBox()
    const qtyBox = await row.locator('.mat-qty').boundingBox()

    if (!nameBox || !qtyBox) {
      throw new Error('Expected material row columns to render with bounding boxes.')
    }

    expect(Math.abs(qtyBox.y - nameBox.y)).toBeLessThan(12)

    const hasNoHorizontalScroll = await page.evaluate(() => (
      document.documentElement.scrollWidth <= window.innerWidth + 1
    ))
    expect(hasNoHorizontalScroll).toBe(true)
  })
}
