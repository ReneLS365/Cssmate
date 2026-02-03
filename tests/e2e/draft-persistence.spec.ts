import { expect, test } from './_test'
import { createConsoleCollector } from './helpers/console-collector'

async function ensureLoggedIn (page) {
  const gate = page.locator('#authGate')
  if (await gate.count() === 0) return
  await expect(gate).toBeHidden()
}

async function resetClientState (page) {
  await page.goto('/')
  await ensureLoggedIn(page)
  await page.waitForSelector('#sagsnummer')
}

async function fillSagsinfo (page, data) {
  await page.getByLabel('Sagsnummer').fill(data.sagsnummer)
  await page.getByLabel('Navn/opgave').fill(data.navn)
  await page.getByLabel('Adresse').fill(data.adresse)
  await page.getByLabel('Kunde').fill(data.kunde)
}

function expectSagsinfoValues (page, data) {
  return Promise.all([
    expect(page.getByLabel('Sagsnummer')).toHaveValue(data.sagsnummer),
    expect(page.getByLabel('Navn/opgave')).toHaveValue(data.navn),
    expect(page.getByLabel('Adresse')).toHaveValue(data.adresse),
    expect(page.getByLabel('Kunde')).toHaveValue(data.kunde),
  ])
}

test.describe('Draft persistence', () => {
  test.beforeEach(async ({ page }) => {
    await resetClientState(page)
  })

  test('autosaves sagsinfo and restores after reload', async ({ page }, testInfo) => {
    const collector = createConsoleCollector(page)
    const draft = {
      sagsnummer: '9001',
      navn: 'Autosave demo',
      adresse: 'Draftvej 12',
      kunde: 'Testkunde'
    }

    try {
      await fillSagsinfo(page, draft)

      await expect.poll(() => page.evaluate(() => localStorage.getItem('csmate:draftJob:v1')))
        .not.toBeNull()

      await page.reload()
      await expect(page.locator('#actionHint')).toContainText('Kladde gendannet', { timeout: 15000 })
      await expectSagsinfoValues(page, draft)
    } finally {
      await collector.attachIfFailed(testInfo)
    }
  })

  test('"Ny sag" clears current draft and fields', async ({ page }, testInfo) => {
    const collector = createConsoleCollector(page)
    const draft = {
      sagsnummer: '1200',
      navn: 'Nulstil demo',
      adresse: 'Sletvej 3',
      kunde: 'Demo kunde'
    }

    try {
      await fillSagsinfo(page, draft)

      await expect.poll(() => page.evaluate(() => localStorage.getItem('csmate:draftJob:v1')))
        .not.toBeNull()

      const newCaseButton = page.getByRole('button', { name: 'Ny sag' })
      page.once('dialog', dialog => dialog.accept())
      await newCaseButton.click()

      await expect(page.locator('#actionHint')).toContainText('Ny sag klar', { timeout: 15000 })
      await expectSagsinfoValues(page, { sagsnummer: '', navn: '', adresse: '', kunde: '' })
      await expect.poll(() => page.evaluate(() => localStorage.getItem('csmate:draftJob:v1')))
        .toBeNull()

      await page.reload()
      await expect(page.locator('#actionHint')).not.toContainText('Kladde gendannet', { timeout: 15000 })
      await expectSagsinfoValues(page, { sagsnummer: '', navn: '', adresse: '', kunde: '' })
    } finally {
      await collector.attachIfFailed(testInfo)
    }
  })
})
