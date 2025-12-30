import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'

function assertEnv(name, value) {
  if (!value || typeof value !== 'string' || !value.trim() || value === '******') {
    throw new Error(`Missing or invalid env: ${name}`)
  }
}

assertEnv('VITE_FIREBASE_API_KEY', import.meta.env.VITE_FIREBASE_API_KEY)
assertEnv('VITE_FIREBASE_AUTH_DOMAIN', import.meta.env.VITE_FIREBASE_AUTH_DOMAIN)
assertEnv('VITE_FIREBASE_PROJECT_ID', import.meta.env.VITE_FIREBASE_PROJECT_ID)
assertEnv('VITE_FIREBASE_APP_ID', import.meta.env.VITE_FIREBASE_APP_ID)

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
}

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
