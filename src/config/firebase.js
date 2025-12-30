import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { isLighthouseMode } from './lighthouse-mode.js'

function assertEnv(name, value) {
  if (!value || typeof value !== 'string' || !value.trim() || value === '******') {
    throw new Error(`Missing or invalid env: ${name}`)
  }
}

const isLighthouse = isLighthouseMode()

if (!isLighthouse) {
  assertEnv('VITE_FIREBASE_API_KEY', import.meta.env.VITE_FIREBASE_API_KEY)
  assertEnv('VITE_FIREBASE_AUTH_DOMAIN', import.meta.env.VITE_FIREBASE_AUTH_DOMAIN)
  assertEnv('VITE_FIREBASE_PROJECT_ID', import.meta.env.VITE_FIREBASE_PROJECT_ID)
  assertEnv('VITE_FIREBASE_APP_ID', import.meta.env.VITE_FIREBASE_APP_ID)
}

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'lh_dummy_key',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'localhost',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'lh-project',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || 'lh-app',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
}

export const app = initializeApp(firebaseConfig)
export const auth = isLighthouse ? null : getAuth(app)
