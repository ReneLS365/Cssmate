import { expect, test } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'

async function persistDownload(download, testInfo, fallbackName) {
  const suggested = download.suggestedFilename() || fallbackName
  const targetPath = testInfo.outputPath(path.basename(suggested))
  await download.saveAs(targetPath)
  return targetPath
}

test('eksport af akkordseddel downloader PDF og JSON', async ({ page }, testInfo) => {
  const uniqueJob = `E2E-EXPORT-${Date.now()}`

  const setNumberInput = async (locator, value) => {
    await locator.waitFor({ state: 'visible' })
    await locator.evaluate((input, nextValue) => {
      if (!(input instanceof HTMLInputElement)) return
      input.removeAttribute('readonly')
      input.value = nextValue
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }, value)
  }

  page.setDefaultTimeout(30000)
  page.setDefaultNavigationTimeout(45000)
  page.on('console', msg => console.log(`[console:${msg.type()}] ${msg.text()}`))
  page.on('pageerror', err => console.log(`[pageerror] ${err.message}`))

  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#sagsnummer', { state: 'visible' })

  await page.getByLabel('Sagsnummer').fill(uniqueJob)
  await page.getByLabel('Navn/opgave').fill('E2E Export sag')
  await page.getByLabel('Adresse').fill('Testvej 1')
  await page.getByLabel('Kunde').fill('Playwright Kunde')
  await page.getByLabel('Dato').fill('2025-01-01')
  await page.getByLabel('Montørnavne').fill('Tester 1')

  await page.getByRole('tab', { name: 'Optælling' }).click()
  const qtyInput = page.locator('#optaellingContainer .material-row input.csm-qty').first()
  await setNumberInput(qtyInput, '2')

  await page.getByRole('tab', { name: 'Løn' }).click()

  const kmInput = page.locator('#km')
  await setNumberInput(kmInput, '5')

  const hoursInput = page.locator('.worker-row input.worker-hours').first()
  await setNumberInput(hoursInput, '1.5')

  await page.evaluate(() => {
    const overlay = document.getElementById('numpad-overlay')
    if (overlay) {
      overlay.classList.add('numpad-hidden')
      overlay.setAttribute('aria-hidden', 'true')
      overlay.style.display = 'none'
    }
  })

  await page.getByRole('button', { name: 'Beregn løn' }).click()

  const exportPanel = page.locator('.export-panel')
  await exportPanel.scrollIntoViewIfNeeded()
  await exportPanel.dispatchEvent('pointerenter')
  await page.waitForTimeout(1000)

  const pdfButton = page.locator('#btn-export-akkord-pdf')
  await expect(pdfButton).toBeEnabled()
  await pdfButton.scrollIntoViewIfNeeded()
  await expect(page.locator('#btn-export-akkord-zip')).toHaveCount(0)
  await expect(page.locator('#btn-export-akkord-demontage')).toHaveCount(0)
  await expect(page.locator('#btn-export-akkord-json')).toHaveCount(0)

  const downloadPromise1 = page.waitForEvent('download', { timeout: 90000 })
  await pdfButton.click()

  const firstDownload = await downloadPromise1
  const secondDownload = await page.waitForEvent('download', { timeout: 90000 })
  const downloads = [firstDownload, secondDownload]
  const pdfDownload = downloads.find(entry => entry.suggestedFilename().toLowerCase().endsWith('.pdf'))
  const jsonDownload = downloads.find(entry => entry.suggestedFilename().toLowerCase().endsWith('.json'))

  expect(pdfDownload).toBeTruthy()
  expect(jsonDownload).toBeTruthy()

  const pdfPath = await persistDownload(pdfDownload!, testInfo, 'akkordseddel.pdf')
  const pdfStats = await fs.stat(pdfPath)
  expect(pdfDownload!.suggestedFilename()).toMatch(/\.pdf$/i)
  expect(pdfStats.size).toBeGreaterThan(0)

  const jsonPath = await persistDownload(jsonDownload!, testInfo, 'akkordseddel.json')
  const jsonStats = await fs.stat(jsonPath)
  expect(jsonDownload!.suggestedFilename()).toMatch(/\.json$/i)
  expect(jsonStats.size).toBeGreaterThan(0)
})
