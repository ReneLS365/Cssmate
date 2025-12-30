import { initAuthSession } from './session.js'
import { initAuthProvider } from './auth-provider.js'
import { initSharedAuth } from '../../js/shared-auth.js'
import { isLighthouseMode } from '../config/lighthouse-mode.js'

let bootstrapPromise = null

export function initAuth () {
  if (bootstrapPromise) return bootstrapPromise
  if (isLighthouseMode()) {
    bootstrapPromise = Promise.resolve()
    return bootstrapPromise
  }
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
