import assert from 'node:assert/strict'
import test from 'node:test'

import { getDeployContext, getPreviewWriteDisabledMessage, isWritesAllowed } from '../src/lib/deploy-context.js'

function setWindowContext ({ hostname, search = '', env = {} }) {
  globalThis.window = {
    location: {
      hostname,
      search,
    },
    __ENV__: env,
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
  }
}

async function withWindowContext (config, fn) {
  const originalWindow = globalThis.window
  try {
    setWindowContext(config)
    await fn()
  } finally {
    globalThis.window = originalWindow
    if (originalWindow === undefined) delete globalThis.window
  }
}

test('sscaff.netlify.app is treated as production without env context', async () => {
  await withWindowContext({ hostname: 'sscaff.netlify.app' }, async () => {
    const context = getDeployContext()
    assert.equal(context.isPreview, false)
    assert.equal(context.writesAllowed, true)
    assert.equal(isWritesAllowed(), true)
  })
})

test('deploy-preview hostnames are treated as preview', async () => {
  await withWindowContext({ hostname: 'deploy-preview-42--sscaff.netlify.app' }, async () => {
    const context = getDeployContext()
    assert.equal(context.isPreview, true)
    assert.equal(context.writesAllowed, false)
    assert.equal(isWritesAllowed(), false)
  })
})

test('branch deploy hostnames are treated as preview', async () => {
  await withWindowContext({ hostname: 'feature-x--sscaff.netlify.app' }, async () => {
    const context = getDeployContext()
    assert.equal(context.isPreview, true)
    assert.equal(context.writesAllowed, false)
  })
})

test('env context deploy-preview disables writes even on custom domains', async () => {
  await withWindowContext({ hostname: 'example.com', env: { VITE_NETLIFY_CONTEXT: 'deploy-preview' } }, async () => {
    const context = getDeployContext()
    assert.equal(context.context, 'deploy-preview')
    assert.equal(context.isPreview, true)
    assert.equal(context.writesAllowed, false)
    assert.match(getPreviewWriteDisabledMessage(), /deploy preview/i)
  })
})

test('env context production overrides preview hostname heuristics', async () => {
  await withWindowContext({ hostname: 'deploy-preview-99--sscaff.netlify.app', env: { VITE_NETLIFY_CONTEXT: 'production' } }, async () => {
    const context = getDeployContext()
    assert.equal(context.context, 'production')
    assert.equal(context.isPreview, false)
    assert.equal(context.writesAllowed, true)
  })
})
