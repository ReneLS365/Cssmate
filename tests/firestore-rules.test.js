import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');

async function setupEnv(t) {
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  const [host, portString] = emulatorHost.split(':');
  try {
    const testEnv = await initializeTestEnvironment({
      projectId: 'cssmate-test',
      firestore: { rules, host, port: Number(portString) },
    });
    t.after(async () => {
      await testEnv.cleanup();
    });
    return testEnv;
  } catch (error) {
    t.skip(`Firestore emulator ikke tilgængelig (${error.message || error})`);
    return null;
  }
}

test('members kan læse og skrive i deres eget team', async (t) => {
  const testEnv = await setupEnv(t);
  if (!testEnv) return;
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc('teams/sscaff-team-alpha/members/user-1').set({ uid: 'user-1', role: 'member', active: true });
    await db.doc('teams/sscaff-team-alpha/cases/case-1').set({ status: 'kladde', deletedAt: null });
  });

  const memberDb = testEnv.authenticatedContext('user-1').firestore();
  await assertSucceeds(memberDb.doc('teams/sscaff-team-alpha/cases/case-1').get());
  await assertSucceeds(memberDb.doc('teams/sscaff-team-alpha/cases/case-2').set({ status: 'kladde', deletedAt: null }));
  await assertFails(memberDb.doc('teams/sscaff-team-beta/cases/other').get());
});

test('admin kan gendanne og hard delete på eget team', async (t) => {
  const testEnv = await setupEnv(t);
  if (!testEnv) return;
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc('teams/sscaff-team-alpha/members/admin-1').set({ uid: 'admin-1', role: 'admin', active: true });
    await db.doc('teams/sscaff-team-alpha/cases/case-restore').set({ status: 'deleted', deletedAt: new Date().toISOString() });
  });

  const adminDb = testEnv.authenticatedContext('admin-1').firestore();
  await assertSucceeds(adminDb.doc('teams/sscaff-team-alpha/cases/case-restore').set({ deletedAt: null }, { merge: true }));
  await assertSucceeds(adminDb.doc('teams/sscaff-team-alpha/cases/case-restore').delete());
});

test('backup operations kræver admin og korrekt team', async (t) => {
  const testEnv = await setupEnv(t);
  if (!testEnv) return;
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc('teams/sscaff-team-alpha/members/user-2').set({ uid: 'user-2', role: 'member', active: true });
    await db.doc('teams/sscaff-team-alpha/members/admin-2').set({ uid: 'admin-2', role: 'admin', active: true });
  });

  const memberDb = testEnv.authenticatedContext('user-2').firestore();
  const adminDb = testEnv.authenticatedContext('admin-2').firestore();

  await assertFails(memberDb.doc('teams/sscaff-team-alpha/backups/backup-1').set({ createdAt: new Date().toISOString() }));
  await assertFails(memberDb.doc('teams/sscaff-team-beta/backups/backup-2').get());

  await assertSucceeds(adminDb.doc('teams/sscaff-team-alpha/backups/backup-1').set({ createdAt: new Date().toISOString() }));
});
