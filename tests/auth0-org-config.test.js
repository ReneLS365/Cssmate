import assert from 'node:assert/strict'
import test from 'node:test'

function setWindowEnv(env) {
  globalThis.window = {
    __ENV__: env,
  }
}

test('resolveOrgConfig reads organization ID aliases', async t => {
  const originalWindow = globalThis.window

  setWindowEnv({
    VITE_AUTH0_ORGANIZATION_ID: 'org_abc123',
  })

  const { __test__ } = await import('../src/auth/auth0-client.js')

  t.after(() => {
    globalThis.window = originalWindow
    if (originalWindow === undefined) delete globalThis.window
  })

  const orgConfig = __test__.getOrgConfig()
  assert.equal(orgConfig.orgId, 'org_abc123')
  assert.equal(orgConfig.organization, 'org_abc123')
  assert.equal(orgConfig.source, 'id')
})

test('resolveOrgConfig reads organization slug aliases', async t => {
  const originalWindow = globalThis.window

  setWindowEnv({
    VITE_AUTH0_ORGANIZATION_SLUG: 'team-hulmose',
  })

  const { __test__ } = await import('../src/auth/auth0-client.js')

  t.after(() => {
    globalThis.window = originalWindow
    if (originalWindow === undefined) delete globalThis.window
  })

  const orgConfig = __test__.getOrgConfig()
  assert.equal(orgConfig.orgSlug, 'team-hulmose')
  assert.equal(orgConfig.organization, 'team-hulmose')
  assert.equal(orgConfig.source, 'slug')
})
