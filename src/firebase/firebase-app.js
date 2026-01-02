import { FIREBASE_SDK_VERSION } from '../config/firebase-sdk.js'
import { getFirebaseConfig } from './firebase-config.js'

let appPromise = null
let sdkPromise = null

async function loadFirebaseAppSdk() {
  if (sdkPromise) return sdkPromise
  sdkPromise = import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`)
  return sdkPromise
}

export function getFirebaseApp() {
  if (!appPromise) {
    appPromise = (async () => {
      const config = getFirebaseConfig()

      if (!config || !config.apiKey) {
        throw new Error('Firebase config missing apiKey')
      }

      const sdk = await loadFirebaseAppSdk()
      if (sdk.getApps().length === 0) {
        return sdk.initializeApp(config)
      }

      return sdk.getApps()[0]
    })()
  }
  return appPromise
}
