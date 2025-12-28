import test from 'node:test'
import assert from 'node:assert/strict'

test('refreshAccess allows bootstrap even with a prior flag', async (t) => {
  const originalWindow = globalThis.window
  globalThis.window = {
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
    sessionStorage: {
      getItem: () => '1',
      setItem: () => {},
      removeItem: () => {},
    },
  }

  let session

  t.after(() => {
    if (originalWindow) globalThis.window = originalWindow
    else delete globalThis.window
    if (session?.__setSessionDepsForTest) {
      session.__setSessionDepsForTest({ reset: true })
    }
  })

  const guardTeamAccessCalls = []
  const guardTeamAccessMock = async (teamId, user, options) => {
    guardTeamAccessCalls.push({ teamId, user, options })
    return {
      role: 'admin',
      teamId,
      membership: { role: 'owner', active: true },
    }
  }

  session = await import('../src/auth/session.js')

  session.__setSessionDepsForTest({
    guardTeamAccess: guardTeamAccessMock,
    getAuthContext: () => ({
      isAuthenticated: true,
      isReady: true,
      user: { uid: 'admin-uid', email: 'mr.lion1995@gmail.com', displayName: 'Admin' },
    }),
  })

  await session.refreshAccess()

  assert.equal(guardTeamAccessCalls.length, 1)
  assert.equal(guardTeamAccessCalls[0].options.allowBootstrap, true)
})
