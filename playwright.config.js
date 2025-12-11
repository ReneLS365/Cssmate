import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173'
const shouldStartServer = !process.env.PLAYWRIGHT_SKIP_WEBSERVER
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  timeout: 120_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    headless: true,
    ...devices['Pixel 5'],
    trace: 'retain-on-failure',
    viewport: { width: 393, height: 851 },
  },
  projects: [
    {
      name: 'chromium',
    },
  ],
  webServer: shouldStartServer
    ? {
        command: 'npm run start:ci',
        port: 4173,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      }
    : undefined,
  outputDir: 'test-results/playwright',
})
