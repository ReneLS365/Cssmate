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

integrationTest('inviterede brugere kan oprette eget medlem, andre afvises', async (t) => {
  const testEnv = await setupEnv(t);
  if (!testEnv) return;

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc('teams/sscaff-team-alpha').set({ name: 'Alpha' });
    await db.doc('teams/sscaff-team-alpha/invites/invited@example.com').set({ active: true, role: 'member' });
  });

  const invitedDb = testEnv.authenticatedContext('invited-uid', { email: 'invited@example.com' }).firestore();
  const otherDb = testEnv.authenticatedContext('stranger', { email: 'other@example.com' }).firestore();

  await assertSucceeds(invitedDb.doc('teams/sscaff-team-alpha/members/invited-uid').set({
    uid: 'invited-uid',
    email: 'invited@example.com',
    role: 'member',
    active: true,
  }, { merge: true }));

  await assertFails(otherDb.doc('teams/sscaff-team-alpha/members/stranger').set({
    uid: 'stranger',
    email: 'other@example.com',
    role: 'member',
    active: true,
  }, { merge: true }));
});

integrationTest('kun admin kan liste medlemmer og invites', async (t) => {
  const testEnv = await setupEnv(t);
  if (!testEnv) return;

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc('teams/sscaff-team-alpha').set({ name: 'Alpha' });
    await db.doc('teams/sscaff-team-alpha/members/admin-1').set({ uid: 'admin-1', role: 'admin', active: true });
    await db.doc('teams/sscaff-team-alpha/members/member-1').set({ uid: 'member-1', role: 'member', active: true });
    await db.doc('teams/sscaff-team-alpha/invites/member@example.com').set({ role: 'member', active: true });
  });

  const adminDb = testEnv.authenticatedContext('admin-1', { email: ADMIN_EMAIL }).firestore();
  const memberDb = testEnv.authenticatedContext('member-1', { email: 'member@example.com' }).firestore();

  await assertSucceeds(adminDb.collection('teams/sscaff-team-alpha/members').get());
  await assertFails(memberDb.collection('teams/sscaff-team-alpha/members').get());

  await assertSucceeds(adminDb.collection('teams/sscaff-team-alpha/invites').get());
  await assertFails(memberDb.collection('teams/sscaff-team-alpha/invites').get());
});

integrationTest('kun aktive medlemmer kan arbejde med cases', async (t) => {
  const testEnv = await setupEnv(t);
  if (!testEnv) return;

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc('teams/sscaff-team-alpha').set({ name: 'Alpha' });
    await db.doc('teams/sscaff-team-alpha/members/member-a').set({ uid: 'member-a', role: 'member', active: true });
  });

  const memberDb = testEnv.authenticatedContext('member-a', { email: 'member@example.com' }).firestore();
  const strangerDb = testEnv.authenticatedContext('stranger', { email: 'stranger@example.com' }).firestore();

  await assertSucceeds(memberDb.doc('teams/sscaff-team-alpha/cases/case-1').set({
    teamId: 'sscaff-team-alpha',
    createdBy: 'member-a',
    status: 'kladde',
    createdAt: new Date(),
  }));

  await assertFails(strangerDb.doc('teams/sscaff-team-alpha/cases/case-1').get());
});

integrationTest('bootstrap admin kan oprette team uden invites', async (t) => {
  const testEnv = await setupEnv(t);
  if (!testEnv) return;

  const adminDb = testEnv.authenticatedContext('admin-bootstrap', { email: ADMIN_EMAIL }).firestore();
  const memberDoc = adminDb.doc('teams/sscaff-team-hulmose/members/admin-bootstrap');

  await assertSucceeds(adminDb.doc('teams/sscaff-team-hulmose').set({ name: 'Hulmose' }));
  await assertSucceeds(memberDoc.set({ uid: 'admin-bootstrap', role: 'admin', active: true }));

  const otherDb = testEnv.authenticatedContext('user-x', { email: 'user@example.com' }).firestore();
  await assertFails(otherDb.doc('teams/sscaff-team-anden').set({ teamId: 'teams-anden' }));
  await assertFails(otherDb.doc('teams/sscaff-team-anden/members/user-x').set({ uid: 'user-x', role: 'admin' }));
});
