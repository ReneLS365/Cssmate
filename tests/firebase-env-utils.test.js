import assert from 'node:assert/strict';
import test from 'node:test';

import { validateFirebaseEnv } from '../tools/firebase-env-utils.mjs';

test('validateFirebaseEnv flags missing env vars', () => {
  const { status } = validateFirebaseEnv({});
  assert.equal(status.isValid, false);
  assert.ok(status.missingKeys.includes('VITE_FIREBASE_API_KEY'));
  assert.ok(status.missingKeys.includes('VITE_FIREBASE_AUTH_DOMAIN'));
  assert.ok(status.missingKeys.includes('VITE_FIREBASE_PROJECT_ID'));
  assert.ok(status.missingKeys.includes('VITE_FIREBASE_APP_ID'));
});

test('validateFirebaseEnv flags placeholder env vars', () => {
  const { status } = validateFirebaseEnv({
    VITE_FIREBASE_API_KEY: '***',
    VITE_FIREBASE_AUTH_DOMAIN: 'changeme',
    VITE_FIREBASE_PROJECT_ID: 'project',
    VITE_FIREBASE_APP_ID: 'replace_me',
  });
  assert.equal(status.isValid, false);
  assert.ok(status.placeholderKeys.length >= 2);
});

test('validateFirebaseEnv passes trimmed values', () => {
  const { status } = validateFirebaseEnv({
    VITE_FIREBASE_API_KEY: 'AIzaSy-test-key-123456789012345 ',
    VITE_FIREBASE_AUTH_DOMAIN: 'auth.example.com',
    VITE_FIREBASE_PROJECT_ID: ' proj ',
    VITE_FIREBASE_APP_ID: 'app',
  });
  assert.equal(status.isValid, true);
});
