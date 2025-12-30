import { validateFirebaseEnv } from './firebase-env-utils.mjs';

if (process.env.CSSMATE_SKIP_FIREBASE_ENV_CHECK === '1') {
  console.warn('[firebase-env] Skipping Firebase env verification (CSSMATE_SKIP_FIREBASE_ENV_CHECK=1).');
  process.exit(0);
}

const { status } = validateFirebaseEnv();
const missing = status.missingKeys || [];
const placeholders = status.placeholderKeys || [];

if (missing.length || placeholders.length) {
  const entries = [...new Set([...missing, ...placeholders])].filter(Boolean);
  console.error('[firebase-env] Missing or placeholder Firebase env vars:');
  entries.forEach(key => {
    console.error(`- ${key}`);
  });
  process.exit(1);
}

console.log('[firebase-env] Firebase environment variables OK.');
