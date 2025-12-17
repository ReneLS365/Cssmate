import assert from 'node:assert/strict';
import test from 'node:test';
import { validateBackupSchema } from '../js/shared-ledger.js';

const VALID_PAYLOAD = { schemaVersion: 1 };

test('validateBackupSchema accepterer gyldigt schema', () => {
  assert.doesNotThrow(() => validateBackupSchema({ ...VALID_PAYLOAD }));
});

test('validateBackupSchema afviser ukendt schemaVersion', () => {
  assert.throws(() => validateBackupSchema({ schemaVersion: 99 }), /Ukendt backup-format/);
  assert.throws(() => validateBackupSchema(null), /Ukendt backup-format/);
});
