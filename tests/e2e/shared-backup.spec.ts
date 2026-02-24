import { expect, test } from './_test'
import { installSharedCasesMock, loadSharedCasesFixture } from './helpers/shared-cases'
import { openTab } from './helpers/tab-nav'

const fixture = loadSharedCasesFixture()

test.describe('Delte sager backup admin tools (E2E)', () => {
  test('admin can export and import backup', async ({ page }) => {
    await page.addInitScript(() => {
      window.VITE_E2E_BYPASS_AUTH = '1'
      window.confirm = () => true
    })

    let exportCalls = 0
    let importCalls = 0

    await installSharedCasesMock(page, { fixture, role: 'admin' })

    await page.route('**/api/teams/**/backup**', async (route, request) => {
      const method = request.method()
      if (method === 'GET') {
        exportCalls += 1
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            schemaVersion: 2,
            teamId: 'hulmose',
            exportedAt: new Date().toISOString(),
            cases: fixture.cases,
            audit: [],
          }),
        })
      }
      if (method === 'POST') {
        importCalls += 1
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
      }
      return route.fallback()
    })

    await page.goto('/?tab=delte-sager&skipAuthGate=1', { waitUntil: 'domcontentloaded' })
    await openTab(page, { id: 'delte-sager', label: 'Delt sager' })

    await expect(page.locator('#sharedAdminTools')).toBeVisible()
    await expect(page.locator('#sharedBackupExportBtn')).toBeVisible()

    const downloadPromise = page.waitForEvent('download')
    await page.locator('#sharedBackupExportBtn').click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/^cssmate-backup-hulmose-\d{4}-\d{2}-\d{2}\.json$/)
    await expect.poll(() => exportCalls).toBe(1)

    await page.setInputFiles('#sharedBackupImportFile', {
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({
        schemaVersion: 2,
        teamId: 'hulmose',
        exportedAt: new Date().toISOString(),
        cases: fixture.cases,
        audit: [],
      })),
    })

    await page.locator('#sharedBackupImportBtn').click()

    await expect.poll(() => importCalls).toBe(1)
    await expect(page.locator('#sharedBackupStatus')).toContainText('Backup importeret')
    await expect(page.locator('#sharedCasesRefreshBtn')).toBeEnabled()
  })
})
