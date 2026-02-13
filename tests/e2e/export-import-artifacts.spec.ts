import { expect, test } from './_test'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createConsoleCollector } from './helpers/console-collector'
import { gotoApp, openTab } from './helpers/tab-nav'

const ARTIFACT_ROOT = path.resolve('release-artifacts/v2025.12.10')
const SCENARIO_DIRS = {
  basic: path.join(ARTIFACT_ROOT, 'basic'),
  multi: path.join(ARTIFACT_ROOT, 'multi'),
  combined: path.join(ARTIFACT_ROOT, 'combined'),
  edge: path.join(ARTIFACT_ROOT, 'edge'),
}

async function ensureLoggedIn (page) {
  const gate = page.locator('#authGate')
  if (await gate.count() === 0) return
  await page.waitForTimeout(50)
  await expect(gate).toBeHidden()
}

async function ensureScenarioFolders() {
  await Promise.all(
    Object.values(SCENARIO_DIRS).map(dir => fs.mkdir(dir, { recursive: true })),
  )
}

async function setNumberInput(locator, value) {
  await locator.waitFor({ state: 'visible' })
  await locator.evaluate((input, nextValue) => {
    if (!(input instanceof HTMLInputElement)) return
    input.removeAttribute('readonly')
    input.value = nextValue
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

const SYSTEM_LABELS = {
  Bosta: 'BOSTA 2025',
  HAKI: 'HAKI 2025',
  MODEX: 'MODEX 2025',
  Alfix: 'ALFIX 2025',
}

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return
  try {
    const debug = await page.evaluate(() => window.__exportDebug || [])
    console.log('export debug:', JSON.stringify(debug, null, 2))
  } catch (error) {
    console.log('export debug unavailable', error)
  }
})

async function selectSystems(page, labels) {
  await openTab(page, { id: 'optaelling', label: 'Optælling' })
  await page.waitForSelector('#listSelectors input[type="checkbox"]', { state: 'visible' })
  for (const label of labels) {
    const resolvedLabel = SYSTEM_LABELS[label] || label
    const checkbox = page.locator('#listSelectors').getByLabel(resolvedLabel, { exact: true })
    await checkbox.check({ force: true })
  }
}
async function fillStamdata(page, overrides = {}) {
  await page.waitForSelector('#sagsnummer', { state: 'visible' })
  const defaultData = {
    sagsnummer: `E2E-${Date.now()}`,
    navn: 'Automatisk testopgave',
    adresse: 'Testvej 1',
    kunde: 'Playwright Kunde',
    dato: '2025-01-01',
    montoer: 'Tester 1',
  }
  const data = { ...defaultData, ...overrides }

  await page.evaluate(values => {
    Object.entries(values).forEach(([id, value]) => {
      const el = document.getElementById(id)
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.removeAttribute('readonly')
        el.value = value
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }
    })
  }, {
    sagsnummer: data.sagsnummer,
    sagsnavn: data.navn,
    sagsadresse: data.adresse,
    sagskunde: data.kunde,
    sagsdato: data.dato,
    sagsmontoer: data.montoer,
  })

  await expect(page.getByLabel('Navn/opgave')).toHaveValue(data.navn)
  await expect(page.getByLabel('Kunde')).toHaveValue(data.kunde)
}

async function populateMaterials(page, quantities) {
  await openTab(page, { id: 'optaelling', label: 'Optælling' })
  await page.waitForSelector('#optaellingContainer .material-row input.csm-qty')

  const inputs = page.locator('#optaellingContainer .material-row input.csm-qty')
  const count = await inputs.count()
  for (let index = 0; index < quantities.length && index < count; index += 1) {
    await setNumberInput(inputs.nth(index), String(quantities[index]))
  }
}

async function populateLon(page) {
  await openTab(page, { id: 'lon', label: 'Løn' })
  await page.waitForSelector('#km')
  await setNumberInput(page.locator('#km'), '5')
  await setNumberInput(page.locator('.worker-row input.worker-hours').first(), '1.5')
  await page.getByRole('button', { name: 'Beregn løn' }).click()
}

async function exportPdfAndJson(page, scenarioKey, baseName) {
  const targetDir = SCENARIO_DIRS[scenarioKey]
  await fs.mkdir(targetDir, { recursive: true })

  await page.waitForFunction(() => typeof (window as any).__EXPORT__ === 'function')

  const [firstDownload, secondDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.waitForEvent('download', { timeout: 15000 }),
    page.evaluate(() => (window as any).__EXPORT__()),
  ])
  const downloads = [firstDownload, secondDownload]
  const pdfDownload = downloads.find(entry => entry.suggestedFilename().toLowerCase().endsWith('.pdf'))
  const jsonDownload = downloads.find(entry => entry.suggestedFilename().toLowerCase().endsWith('.json'))

  expect(pdfDownload, 'PDF download mangler').toBeTruthy()
  expect(jsonDownload, 'JSON download mangler').toBeTruthy()

  const filenames = downloads.map(entry => entry.suggestedFilename())
  expect(filenames.some(name => name.toLowerCase().endsWith('.json'))).toBeTruthy()
  expect(filenames.some(name => name.toLowerCase().endsWith('.pdf'))).toBeTruthy()

  const pdfPath = path.join(targetDir, `${baseName}.pdf`)
  const jsonPath = path.join(targetDir, `${baseName}.json`)

  await pdfDownload.saveAs(pdfPath)

  await jsonDownload.saveAs(jsonPath)

  return { pdfPath, jsonPath }
}

async function importJson(page, filePath, expected = {}) {
  await openTab(page, { id: 'sagsinfo', label: 'Sagsinfo' })
  await page.getByRole('button', { name: /Importér akkordseddel/i }).click()
  const absolutePath = path.resolve(filePath)
  const content = await fs.readFile(absolutePath, 'utf8')
  const result = await page.evaluate(async payload => {
    if (typeof window.cssmateHandleAkkordImport !== 'function') {
      return { error: 'handler missing' }
    }
    try {
      const blob = new Blob([payload.content], { type: 'application/json' })
      const file = new File([blob], payload.name, { type: 'application/json' })
      await window.cssmateHandleAkkordImport(file)
      const start = Date.now()
      return await new Promise(resolve => {
        const check = () => {
          const jobName = document.getElementById('sagsnavn')?.value || ''
          const customer = document.getElementById('sagskunde')?.value || ''
          if (jobName || Date.now() - start > 5000) {
            resolve({ jobName, customer })
            return
          }
          requestAnimationFrame(check)
        }
        check()
      })
    } catch (error) {
      return { error: error?.message || String(error) }
    }
  }, { content, name: path.basename(absolutePath) })

  expect(result?.error, result?.error || '').toBeFalsy()
  await page.waitForFunction(({ navn, kunde }) => {
    const jobName = document.getElementById('sagsnavn') as HTMLInputElement | null
    const customer = document.getElementById('sagskunde') as HTMLInputElement | null
    const jobValue = (jobName?.value || '').trim()
    const customerValue = (customer?.value || '').trim()
    if (navn) {
      return jobValue === navn && (!kunde || customerValue === kunde)
    }
    return jobValue.length > 0
  }, { arg: { navn: expected.navn, kunde: expected.kunde } })
}

function scrubVolatileFields(value) {
  if (Array.isArray(value)) {
    return value.map(scrubVolatileFields)
  }
  if (value && typeof value === 'object') {
    const cleaned = {}
    for (const [key, entry] of Object.entries(value)) {
      if (['exportedAt', 'id', 'uuid', 'jobId', 'appVersion', 'version'].includes(key)) {
        continue
      }
      cleaned[key] = scrubVolatileFields(entry)
    }
    return cleaned
  }
  return value
}

test.beforeAll(async () => {
  await ensureScenarioFolders()
})

async function createBasicJob(page) {
  await fillStamdata(page, { navn: 'Basisjob', kunde: 'Basis kunde' })
  await populateMaterials(page, [3, 5])
  await populateLon(page)
}

async function createMultiSystemJob(page) {
  await fillStamdata(page, { navn: 'Multisystem', kunde: 'Flere systemer' })
  await openTab(page, { id: 'optaelling', label: 'Optælling' })
  await selectSystems(page, ['Bosta', 'HAKI', 'MODEX'])
  await populateMaterials(page, [2, 4, 1, 3])
  await populateLon(page)
}

async function createCombinedJob(page) {
  await fillStamdata(page, { navn: 'Kombineret liste', kunde: 'Kombineret kunde' })
  await openTab(page, { id: 'optaelling', label: 'Optælling' })
  await selectSystems(page, ['Bosta', 'Alfix'])
  await populateMaterials(page, [1, 2, 3])
  await openTab(page, { id: 'lon', label: 'Løn' })
  await page.locator('#jobType').selectOption('demontage')
  await populateLon(page)
}

test('basic job: export/import generates artifacts', async ({ page }, testInfo) => {
  const collector = createConsoleCollector(page)
  try {
    await gotoApp(page, { tabId: 'sagsinfo' })
    await ensureLoggedIn(page)
    await createBasicJob(page)

    const { jsonPath } = await exportPdfAndJson(page, 'basic', 'basic')

    await gotoApp(page, { tabId: 'sagsinfo' })
    await ensureLoggedIn(page)
    await importJson(page, jsonPath, { navn: 'Basisjob', kunde: 'Basis kunde' })

    await expect(page.getByLabel('Navn/opgave')).toHaveValue('Basisjob')
    await expect(page.getByLabel('Kunde')).toHaveValue('Basis kunde')

    const second = await exportPdfAndJson(page, 'basic', 'basic-roundtrip')

    const original = JSON.parse(await fs.readFile(jsonPath, 'utf8'))
    const roundtrip = JSON.parse(await fs.readFile(second.jsonPath, 'utf8'))

    expect(scrubVolatileFields(original)).toEqual(scrubVolatileFields(roundtrip))
  } finally {
    await collector.attachIfFailed(testInfo)
  }
})

test('multi-system job exports and imports with artifacts', async ({ page }, testInfo) => {
  const collector = createConsoleCollector(page)
  try {
    await gotoApp(page, { tabId: 'sagsinfo' })
    await ensureLoggedIn(page)
    await createMultiSystemJob(page)

    const { jsonPath } = await exportPdfAndJson(page, 'multi', 'multi')

    await gotoApp(page, { tabId: 'sagsinfo' })
    await ensureLoggedIn(page)
    await importJson(page, jsonPath, { navn: 'Multisystem', kunde: 'Flere systemer' })

    await expect(page.getByLabel('Navn/opgave')).toHaveValue('Multisystem')
    await expect(page.getByLabel('Kunde')).toHaveValue('Flere systemer')

    const systemCheckboxes = page.locator('#listSelectors input[type=\"checkbox\"]:checked')
    await expect(systemCheckboxes).toHaveCount(3)
  } finally {
    await collector.attachIfFailed(testInfo)
  }
})

test('combined lists job exports and imports with artifacts', async ({ page }, testInfo) => {
  const collector = createConsoleCollector(page)
  try {
    await gotoApp(page, { tabId: 'sagsinfo' })
    await ensureLoggedIn(page)
    await createCombinedJob(page)

    const { jsonPath } = await exportPdfAndJson(page, 'combined', 'combined')

    await gotoApp(page, { tabId: 'sagsinfo' })
    await ensureLoggedIn(page)
    await importJson(page, jsonPath, { navn: 'Kombineret liste', kunde: 'Kombineret kunde' })

    await expect(page.getByLabel('Navn/opgave')).toHaveValue('Kombineret liste')
    await expect(page.locator('#jobType')).toHaveValue('demontage')
  } finally {
    await collector.attachIfFailed(testInfo)
  }
})
