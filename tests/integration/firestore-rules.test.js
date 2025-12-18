import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';

const PROJECT_ID = 'sscaff-43a33';
const ADMIN_EMAIL = 'mr.lion1995@gmail.com';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(path.join(__dirname, '..', '..', 'firestore.rules'), 'utf8');
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_EMULATOR_HOST;
const integrationTest = emulatorHost ? test : test.skip;

async function setupEnv(t) {
  const [host, portString] = emulatorHost.split(':');
  const port = portString ? Number(portString) : 8080;
  try {
    const testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules, host, port },
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

integrationTest('brugerprofiler kan kun ændre rolle/team via admin', async (t) => {
  const testEnv = await setupEnv(t);
  if (!testEnv) return;

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc('users/admin-1').set({ uid: 'admin-1', role: 'admin', teamId: 'sscaff-team-alpha' });
    await db.doc('users/user-1').set({ uid: 'user-1', role: 'member', teamId: 'sscaff-team-alpha' });
    await db.doc('teams/sscaff-team-alpha/members/admin-1').set({ uid: 'admin-1', role: 'admin', active: true });
    await db.doc('teams/sscaff-team-alpha/members/user-1').set({ uid: 'user-1', role: 'member', active: true });
  });

  const userDb = testEnv.authenticatedContext('user-1').firestore();
  await assertSucceeds(userDb.doc('users/user-1').get());
  await assertFails(userDb.doc('users/user-2').get());
  await assertSucceeds(userDb.doc('users/user-1').set({ displayName: 'User One' }, { merge: true }));
  await assertFails(userDb.doc('users/user-1').set({ role: 'admin' }, { merge: true }));
  await assertFails(userDb.doc('users/user-1').set({ teamId: 'sscaff-team-beta' }, { merge: true }));

  const adminDb = testEnv.authenticatedContext('admin-1', { email: ADMIN_EMAIL }).firestore();
  await assertSucceeds(adminDb.doc('users/user-1').set({ role: 'member', teamId: 'sscaff-team-alpha' }, { merge: true }));
  await assertFails(adminDb.doc('users/user-2').set({ role: 'member', teamId: 'sscaff-team-beta' }));
});

integrationTest('team-admin kan skrive brugerprofiler for eget team', async (t) => {
  const testEnv = await setupEnv(t);
  if (!testEnv) return;

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc('users/admin-team').set({ uid: 'admin-team', role: 'member', teamId: 'sscaff-team-alpha' });
    await db.doc('users/member-1').set({ uid: 'member-1', role: 'member', teamId: 'sscaff-team-alpha' });
    await db.doc('teams/sscaff-team-alpha/members/admin-team').set({ uid: 'admin-team', role: 'admin', active: true });
    await db.doc('teams/sscaff-team-alpha/members/member-1').set({ uid: 'member-1', role: 'member', active: true });
  });

  const adminDb = testEnv.authenticatedContext('admin-team', { email: ADMIN_EMAIL }).firestore();
  const memberDb = testEnv.authenticatedContext('member-1').firestore();

  await assertSucceeds(adminDb.doc('users/member-1').set({
    teamId: 'sscaff-team-alpha',
    role: 'member',
    displayName: 'Member One',
  }, { merge: true }));

  await assertFails(adminDb.doc('users/member-1').set({
    teamId: 'sscaff-team-beta',
  }, { merge: true }));

  await assertFails(memberDb.doc('users/admin-team').set({
    displayName: 'Ikke admin',
  }, { merge: true }));
});

integrationTest('shared cases er låst til teamet fra brugerprofilen', async (t) => {
  const testEnv = await setupEnv(t);
  if (!testEnv) return;

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc('users/admin-1').set({ uid: 'admin-1', role: 'admin', teamId: 'sscaff-team-alpha' });
    await db.doc('users/member-a').set({ uid: 'member-a', role: 'member', teamId: 'sscaff-team-alpha' });
    await db.doc('users/member-b').set({ uid: 'member-b', role: 'member', teamId: 'sscaff-team-beta' });
    await db.doc('teams/sscaff-team-alpha/members/admin-1').set({ uid: 'admin-1', role: 'admin', active: true });
    await db.doc('teams/sscaff-team-alpha/members/member-a').set({ uid: 'member-a', role: 'member', active: true });
    await db.doc('teams/sscaff-team-beta/members/member-b').set({ uid: 'member-b', role: 'member', active: true });
  });

  const alphaDb = testEnv.authenticatedContext('member-a').firestore();
  const betaDb = testEnv.authenticatedContext('member-b').firestore();
  const adminDb = testEnv.authenticatedContext('admin-1', { email: ADMIN_EMAIL }).firestore();

  await assertSucceeds(alphaDb.doc('teams/sscaff-team-alpha/cases/case-1').set({
    teamId: 'sscaff-team-alpha',
    createdBy: 'member-a',
    status: 'kladde',
    deletedAt: null,
    createdAt: new Date(),
  }));

  await assertFails(alphaDb.doc('teams/sscaff-team-beta/cases/case-x').set({
    teamId: 'sscaff-team-beta',
    createdBy: 'member-a',
    status: 'kladde',
  }));

  await assertFails(betaDb.doc('teams/sscaff-team-alpha/cases/case-1').get());

  await assertSucceeds(adminDb.doc('teams/sscaff-team-alpha/cases/case-1').set({
    status: 'godkendt',
    teamId: 'sscaff-team-alpha',
  }, { merge: true }));

  await assertFails(adminDb.doc('teams/sscaff-team-alpha/cases/case-1').set({
    teamId: 'sscaff-team-beta',
  }, { merge: true }));
});

integrationTest('kun creator eller admin kan opdatere sager', async (t) => {
  const testEnv = await setupEnv(t);
  if (!testEnv) return;

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc('users/admin-1').set({ uid: 'admin-1', role: 'admin', teamId: 'sscaff-team-alpha' });
    await db.doc('users/member-a').set({ uid: 'member-a', role: 'member', teamId: 'sscaff-team-alpha' });
    await db.doc('users/member-b').set({ uid: 'member-b', role: 'member', teamId: 'sscaff-team-alpha' });
    await db.doc('teams/sscaff-team-alpha/members/admin-1').set({ uid: 'admin-1', role: 'admin', active: true });
    await db.doc('teams/sscaff-team-alpha/members/member-a').set({ uid: 'member-a', role: 'member', active: true });
    await db.doc('teams/sscaff-team-alpha/members/member-b').set({ uid: 'member-b', role: 'member', active: true });
  });

  const creatorDb = testEnv.authenticatedContext('member-a').firestore();
  const otherMemberDb = testEnv.authenticatedContext('member-b').firestore();
  const adminDb = testEnv.authenticatedContext('admin-1', { email: ADMIN_EMAIL }).firestore();
  const caseRef = creatorDb.doc('teams/sscaff-team-alpha/cases/case-owner');

  await assertSucceeds(caseRef.set({
    teamId: 'sscaff-team-alpha',
    createdBy: 'member-a',
    status: 'kladde',
    createdAt: new Date(),
  }));

  await assertFails(otherMemberDb.doc('teams/sscaff-team-alpha/cases/case-owner').set({
    status: 'ændret',
  }, { merge: true }));

  await assertSucceeds(caseRef.set({
    status: 'klar',
  }, { merge: true }));

  await assertSucceeds(adminDb.doc('teams/sscaff-team-alpha/cases/case-owner').set({
    status: 'admin-godkendt',
  }, { merge: true }));
});

integrationTest('audit/ledger-indgange er append-only per team', async (t) => {
  const testEnv = await setupEnv(t);
  if (!testEnv) return;

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc('users/audit-user').set({ uid: 'audit-user', role: 'member', teamId: 'sscaff-team-alpha' });
    await db.doc('teams/sscaff-team-alpha/members/audit-user').set({ uid: 'audit-user', role: 'member', active: true });
  });

  const ledgerDb = testEnv.authenticatedContext('audit-user').firestore();
  const auditRef = ledgerDb.doc('teams/sscaff-team-alpha/audit/event-1');

  await assertSucceeds(auditRef.set({
    teamId: 'sscaff-team-alpha',
    action: 'TEST',
    actor: { uid: 'audit-user', email: 'audit@example.com', name: 'Audit User' },
    timestamp: new Date(),
    summary: 'append only',
  }));

  await assertFails(auditRef.set({
    teamId: 'sscaff-team-alpha',
    summary: 'forsøg på update',
  }, { merge: true }));

  await assertFails(auditRef.delete());
});

integrationTest('whitelisted admin kan bootstrap team, andre kan ikke', async (t) => {
  const testEnv = await setupEnv(t);
  if (!testEnv) return;

  const adminDb = testEnv.authenticatedContext('admin-bootstrap', { email: ADMIN_EMAIL }).firestore();
  const memberDoc = adminDb.doc('teams/sscaff-team-nyt/members/admin-bootstrap');

  await assertSucceeds(adminDb.doc('teams/sscaff-team-nyt').set({ teamId: 'sscaff-team-nyt', createdBy: 'admin-bootstrap' }));
  await assertSucceeds(memberDoc.set({ uid: 'admin-bootstrap', role: 'admin', active: true }));

  const otherDb = testEnv.authenticatedContext('user-x', { email: 'user@example.com' }).firestore();
  await assertFails(otherDb.doc('teams/sscaff-team-anden').set({ teamId: 'sscaff-team-anden' }));
  await assertFails(otherDb.doc('teams/sscaff-team-anden/members/user-x').set({ uid: 'user-x', role: 'admin' }));
});
