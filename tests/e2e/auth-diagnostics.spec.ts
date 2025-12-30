import { expect, test } from '@playwright/test'

const MOCK_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDiagTestKey-1234567890',
  authDomain: 'diag.example.com',
  projectId: 'diag-project',
  appId: '1:1234567890:web:abcdef',
}

test('auth diagnostics panel shows masked api key', async ({ page }) => {
  await page.addInitScript((config) => {
    sessionStorage.setItem('cssmate:firebaseConfig', JSON.stringify(config))
  }, MOCK_FIREBASE_CONFIG)

  await page.goto('/?diag=1', { waitUntil: 'domcontentloaded' })

  const panel = page.locator('#authDiagnosticsPanel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('Firebase apiKey')
  await expect(panel).toContainText('AIzaSy...7890')
})
