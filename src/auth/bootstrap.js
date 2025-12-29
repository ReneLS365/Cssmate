import { initAuthSession } from './session.js'
import { initAuthProvider } from './auth-provider.js'
import { initSharedAuth } from '../../js/shared-auth.js'

let bootstrapPromise = null

export function initAuth () {
  if (bootstrapPromise) return bootstrapPromise
  bootstrapPromise = (async () => {
    try {
      await initSharedAuth()
    } catch (error) {
      console.warn('Auth bootstrap fejlede', error)
    }
    try {
      initAuthProvider()
      initAuthSession()
    } catch (error) {
      console.warn('Auth session bootstrap fejlede', error)
    }
  })()
  return bootstrapPromise
}
