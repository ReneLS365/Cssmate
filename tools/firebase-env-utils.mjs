import { getFirebaseEnvKeyMap, sanitizeFirebaseConfig, validateFirebaseConfig } from '../src/config/firebase-utils.js';

export function buildFirebaseConfigFromEnv(env = process.env) {
  const envMap = getFirebaseEnvKeyMap();
  const config = {};

  Object.entries(envMap).forEach(([configKey, envKey]) => {
    const rawValue = env?.[envKey];
    if (typeof rawValue === 'string') {
      config[configKey] = rawValue.trim();
      return;
    }
    if (typeof rawValue !== 'undefined' && rawValue !== null) {
      config[configKey] = rawValue;
    }
  });

  return sanitizeFirebaseConfig(config) || {};
}

export function validateFirebaseEnv(env = process.env) {
  const config = buildFirebaseConfigFromEnv(env);
  const status = validateFirebaseConfig(config);
  return { config, status };
}
