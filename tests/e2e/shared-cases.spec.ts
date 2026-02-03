import { expect, test } from '@playwright/test'
import { installSharedCasesMock, loadSharedCasesFixture } from './helpers/shared-cases'

const fixture = loadSharedCasesFixture()

async function openSharedCases(page, { withClockControl = false, conflictCaseId = '' } = {}) {
  if (withClockControl) {
    await page.addInitScript(() => {
      const OriginalDate = Date
      let offsetMs = 0
      class MockDate extends OriginalDate {
        constructor(...args) {
          if (args.length === 0) {
            super(OriginalDate.now() + offsetMs)
          } else {
            super(...args)
          }
        }
        static now() {
          return OriginalDate.now() + offsetMs
        }
      }
      window.__e2eAdvanceTime = (ms) => {
        offsetMs += ms
      }
      // @ts-expect-error - override Date for deterministic tests
      window.Date = MockDate
    })
  }

  await page.addInitScript(() => {
    window.VITE_E2E_BYPASS_AUTH = '1'
  })

  const mock = await installSharedCasesMock(page, { fixture, conflictCaseId })

  await page.goto('/?tab=delte-sager&skipAuthGate=1', { waitUntil: 'domcontentloaded' })
  await page.getByRole('tab', { name: 'Delt sager' }).click()

  await expect(page.locator('#panel-delte-sager')).toBeVisible()
  await expect(page.locator('#sharedCasesList .shared-board')).toBeVisible()

  return mock
}

function getBoardCountLocator(page, status) {
  return page.locator(`.shared-board-column[data-status="${status}"] .shared-board-count`)
}

test.describe('Delte sager v2 (E2E)', () => {
  test('T1 — board loads with correct counts and stable focus', async ({ page }) => {
    await openSharedCases(page)

    await expect(page.locator('#sharedCasesTotalCount')).toHaveText('5 sager')
    await expect(getBoardCountLocator(page, 'kladde')).toHaveText('1')
    await expect(getBoardCountLocator(page, 'godkendt')).toHaveText('1')
    await expect(getBoardCountLocator(page, 'demontage_i_gang')).toHaveText('1')
    await expect(getBoardCountLocator(page, 'afsluttet')).toHaveText('2')

    const jobNumbers = await page.$$eval('.shared-case-card--compact .shared-case-card__title', elements =>
      elements
        .map(el => el.textContent?.trim() || '')
        .filter(Boolean)
    )
    expect(new Set(jobNumbers).size).toBe(jobNumbers.length)
    expect(jobNumbers.length).toBe(5)

    await page.locator('#sharedCasesStatusFocus').selectOption('godkendt')
    await expect(page.locator('#sharedCasesTotalCount')).toHaveText('5 sager')
    await expect(page.locator('#sharedCasesList')).not.toContainText('Ingen delte sager endnu.')

    await page.locator('#sharedCasesStatusFocus').selectOption('demontage_i_gang')
    await expect(page.locator('#sharedCasesTotalCount')).toHaveText('5 sager')
    await expect(page.locator('#sharedCasesList')).not.toContainText('Ingen delte sager endnu.')
  })

  test('T2 — manual refresh updates timestamp and preserves scroll', async ({ page }) => {
    await openSharedCases(page, { withClockControl: true })

    const board = page.locator('#sharedCasesList .shared-board')
    await board.evaluate(el => {
      el.scrollLeft = 240
    })

    const lastUpdatedBefore = await page.locator('#sharedCasesLastUpdated').textContent()
    await page.evaluate(() => window.__e2eAdvanceTime?.(70000))

    await page.locator('#sharedCasesRefreshBtn').click()
    await expect.poll(async () => page.locator('#sharedCasesLastUpdated').textContent()).not.toBe(lastUpdatedBefore)

    const scrollLeft = await board.evaluate(el => el.scrollLeft)
    expect(scrollLeft).toBeGreaterThan(150)

    await expect(page.locator('#sharedCasesTotalCount')).toHaveText('5 sager')
  })

  test('T3 — status change moves card and stays unique', async ({ page }) => {
    await openSharedCases(page)

    const approvedCard = page.locator('.shared-case-card--compact', { hasText: 'JOB-2001' })
    await approvedCard.locator('.shared-case-menu__button').click()
    await page.getByRole('button', { name: 'Sæt til demontage i gang' }).click()

    await expect(page.locator('.shared-board-column[data-status="demontage_i_gang"] .shared-case-card--compact', { hasText: 'JOB-2001' })).toBeVisible()
    await expect(page.locator('.shared-board-column[data-status="godkendt"] .shared-case-card--compact', { hasText: 'JOB-2001' })).toHaveCount(0)
    await expect(page.locator('.shared-case-card--compact', { hasText: 'JOB-2001' })).toHaveCount(1)

    await page.locator('#sharedCasesRefreshBtn').click()
    await expect(page.locator('.shared-board-column[data-status="demontage_i_gang"] .shared-case-card--compact', { hasText: 'JOB-2001' })).toBeVisible()
  })

  test('T4 — offline queue flushes on reconnect', async ({ page }) => {
    await openSharedCases(page)

    await page.context().setOffline(true)

    const approvedCard = page.locator('.shared-case-card--compact', { hasText: 'JOB-2001' })
    await approvedCard.locator('.shared-case-menu__button').click()
    await page.getByRole('button', { name: 'Sæt til demontage i gang' }).click()

    await expect(page.locator('.shared-case-card--compact', { hasText: 'JOB-2001' })).toContainText('Afventer sync')

    await page.context().setOffline(false)
    await page.evaluate(() => window.dispatchEvent(new Event('online')))

    await expect(page.locator('.shared-case-card--compact', { hasText: 'JOB-2001' })).not.toContainText('Afventer sync')
    await expect(page.locator('.shared-board-column[data-status="demontage_i_gang"] .shared-case-card--compact', { hasText: 'JOB-2001' })).toBeVisible()
  })

  test('T5 — conflict modal allows reload from server', async ({ page }) => {
    await openSharedCases(page, { conflictCaseId: '22222222-2222-2222-2222-222222222222' })

    const approvedCard = page.locator('.shared-case-card--compact', { hasText: 'JOB-2001' })
    await approvedCard.locator('.shared-case-menu__button').click()
    await page.getByRole('button', { name: 'Sæt til demontage i gang' }).click()

    await expect(page.locator('.shared-modal__title', { hasText: 'Konflikt' })).toBeVisible()
    await page.getByRole('button', { name: 'Genindlæs fra server' }).click()

    await expect(page.locator('.shared-board-column[data-status="godkendt"] .shared-case-card--compact', { hasText: 'JOB-2001' })).toBeVisible()
  })

  test('T6 — completed detail view shows totals and read-only actions', async ({ page }) => {
    await openSharedCases(page)

    const doneCard = page.locator('.shared-case-card--compact', { hasText: 'JOB-4001' })
    await doneCard.click()

    const modal = page.locator('.shared-case-detail-modal')
    await expect(modal).toBeVisible()

    await expect(modal).toContainText('Montage')
    await expect(modal).toContainText('Demontage')
    await expect(modal).toContainText('Total')

    await expect(modal.locator('.shared-case-detail-modal__actions')).toContainText('Eksporter JSON')
    await expect(modal.locator('.shared-case-detail-modal__actions')).not.toContainText('Indlæs til montage')
    await expect(modal.locator('.shared-case-detail-modal__actions')).not.toContainText('Indlæs til demontage')
  })
})
