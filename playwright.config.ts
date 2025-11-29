import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173'
const shouldStartServer = !process.env.PLAYWRIGHT_SKIP_WEBSERVER

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  timeout: 120_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    ...devices['Pixel 5'],
    trace: 'retain-on-failure',
    viewport: { width: 393, height: 851 },
  },
  webServer: shouldStartServer
    ? {
        command: 'npx http-server . -p 4173 --silent --gzip',
        url: baseURL,
        reuseExistingServer: false,
        timeout: 30_000,
      }
    : undefined,
})
