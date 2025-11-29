import { spawn, spawnSync } from 'child_process'

const SERVER_PORT = process.env.VERIFY_SERVER_PORT || 4173
const SERVER_URL = process.env.VERIFY_SERVER_URL || `http://127.0.0.1:${SERVER_PORT}`

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const runCommand = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  })

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`)
  }
}

const waitForServer = async (url, attempts = 20, delay = 500) => {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        return
      }
    } catch (error) {
      if (error && error.message) {
        // Swallow connection errors while waiting for server to start
      }
    }

    await wait(delay)
  }

  throw new Error(`Server did not start at ${url}`)
}

const getChromePath = async () => {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN

  try {
    const { chromium } = await import('@playwright/test')
    const executable = chromium.executablePath()
    if (executable) {
      return executable
    }
  } catch (error) {
    // Ignore and fall back to default Lighthouse resolution
  }

  return undefined
}

const startServer = () =>
  spawn('node', ['scripts/serve-with-headers.js', `${SERVER_PORT}`, './'], {
    stdio: 'inherit',
  })

const stopServer = (server) => {
  if (server && !server.killed) {
    try {
      server.kill()
    } catch (error) {
      console.error('Failed to stop verify server:', error)
    }
  }
}

const runServerChecks = async () => {
  const server = startServer()
  let serverExited = false

  server.on('exit', (code) => {
    serverExited = true
    if (code && code !== 0) {
      console.error(`Verify server exited with code ${code}`)
    }
  })

  try {
    await waitForServer(SERVER_URL)

    runCommand('npm', ['run', 'test:e2e'], {
      env: {
        ...process.env,
        PLAYWRIGHT_SKIP_WEBSERVER: '1',
        PLAYWRIGHT_BASE_URL: SERVER_URL,
      },
    })

    const chromePath = await getChromePath()
    const lhciEnv = {
      ...process.env,
      LHCI_URL: process.env.LHCI_URL || SERVER_URL,
    }

    if (chromePath) {
      lhciEnv.CHROME_PATH = chromePath
    }

    runCommand('npm', ['run', 'test:lh'], { env: lhciEnv })
  } catch (error) {
    console.error(error.message || error)
    process.exitCode = 1
  } finally {
    if (!serverExited) {
      stopServer(server)
    }
  }
}

await runServerChecks()
