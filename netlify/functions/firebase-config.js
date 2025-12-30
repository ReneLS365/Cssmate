const envKeys = {
  apiKey: 'VITE_FIREBASE_API_KEY',
  authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
  projectId: 'VITE_FIREBASE_PROJECT_ID',
  appId: 'VITE_FIREBASE_APP_ID',
  storageBucket: 'VITE_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'VITE_FIREBASE_MESSAGING_SENDER_ID',
  measurementId: 'VITE_FIREBASE_MEASUREMENT_ID',
};

const REQUIRED_KEYS = ['apiKey', 'authDomain', 'projectId', 'appId'];
const API_KEY_MIN_LENGTH = 20;

const PLACEHOLDER_PATTERNS = [
  /\*{3,}/,
  /changeme/i,
  /replace/i,
  /your[_-]?/i,
  /^undefined$/i,
  /^null$/i,
];

function readEnv(key) {
  const value = process.env[key];
  if (typeof value === 'string') return value.trim();
  return value || '';
}

function isPlaceholder(value) {
  if (typeof value !== 'string') return false;
  return PLACEHOLDER_PATTERNS.some(pattern => pattern.test(value));
}

function isInvalidApiKey(value) {
  if (typeof value !== 'string') return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.length < API_KEY_MIN_LENGTH) return true;
  return isPlaceholder(trimmed);
}

export async function handler() {
  const config = Object.fromEntries(
    Object.entries(envKeys).map(([targetKey, envKey]) => [targetKey, readEnv(envKey)])
  );

  const missing = REQUIRED_KEYS.filter((key) => !config[key]);
  const apiKeyInvalid = isInvalidApiKey(config.apiKey);
  if (missing.length || apiKeyInvalid) {
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        error: 'Missing Firebase configuration on server.',
        missingKeys: missing,
        apiKeyInvalid,
      }),
    };
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(config),
  };
}
