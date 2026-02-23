import { test, expect } from '@playwright/test'

test('shared cases PDF storage routes can be mocked', async ({ page }) => {
  let sawGet = false
  let sawPost = false

  await page.route('**/api/teams/**/cases/**/pdf**', async (route, request) => {
    if (request.method() === 'GET') {
      sawGet = true
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="JOB-1-montage.pdf"',
        },
        body: '%PDF-1.4\n%mock',
      })
      return
    }
    if (request.method() === 'POST') {
      sawPost = true
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, pdf: { phase: 'montage', key: 'cases/hulmose/1/pdf/montage.pdf' } }),
      })
      return
    }
    await route.fallback()
  })

  const getRes = await page.request.get('http://localhost:4173/api/teams/hulmose/cases/case-1/pdf?phase=montage')
  expect(getRes.ok()).toBeTruthy()

  const postRes = await page.request.post('http://localhost:4173/api/teams/hulmose/cases/case-1/pdf', {
    data: { pdfBase64: 'ZmFrZQ==', phase: 'montage' },
  })
  expect(postRes.ok()).toBeTruthy()

  expect(sawGet).toBeTruthy()
  expect(sawPost).toBeTruthy()
})
