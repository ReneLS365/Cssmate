import assert from 'node:assert/strict'
import test from 'node:test'

import { buildAkkordJsonPayload } from '../js/export-json.js'
import { buildExportModel } from '../js/export-model.js'

function createStubElement () {
  return {
    addEventListener () {},
    removeEventListener () {},
    querySelector () { return null },
    querySelectorAll () { return [] },
    appendChild () {},
    focus () {},
    click () {},
    setAttribute () {},
    removeAttribute () {},
    remove () {},
    closest () { return null },
    getBoundingClientRect () { return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 } },
    classList: { add () {}, remove () {}, toggle () {} },
    style: {},
    dataset: {},
    value: '',
    innerHTML: '',
    textContent: '',
    contentDocument: null,
  }
}

function setupGlobalMocks () {
  const original = {
    document: globalThis.document,
    window: globalThis.window,
    self: globalThis.self,
    navigator: globalThis.navigator,
    fetch: globalThis.fetch,
    localStorage: globalThis.localStorage,
    sessionStorage: globalThis.sessionStorage,
    URL: globalThis.URL,
  }

  const element = createStubElement()
  const localStorage = {
    getItem () { return null },
    setItem () {},
    removeItem () {},
  }

  globalThis.document = {
    documentElement: { classList: { add () {}, remove () {}, toggle () {} } },
    body: element,
    createElement () { return createStubElement() },
    getElementById () { return createStubElement() },
    querySelector () { return null },
    querySelectorAll () { return [] },
    addEventListener () {},
    removeEventListener () {},
    dispatchEvent () {},
    readyState: 'complete',
  }
  globalThis.window = {
    addEventListener () {},
    removeEventListener () {},
    dispatchEvent () {},
    CSSMATE_APP_VERSION: 'test',
    localStorage,
    sessionStorage: { ...localStorage },
    navigator: { userAgent: 'node' },
    matchMedia () { return { matches: false, addEventListener () {}, removeEventListener () {} } },
    location: { origin: 'http://localhost', href: 'http://localhost/' },
  }
  globalThis.self = globalThis.window
  globalThis.navigator = globalThis.window.navigator
  globalThis.localStorage = localStorage
  globalThis.sessionStorage = globalThis.window.sessionStorage
  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) })
  globalThis.URL = {
    createObjectURL: () => 'blob:mock',
    revokeObjectURL () {},
  }

  return () => {
    globalThis.document = original.document
    globalThis.window = original.window
    globalThis.self = original.self
    globalThis.navigator = original.navigator
    globalThis.fetch = original.fetch
    globalThis.localStorage = original.localStorage
    globalThis.sessionStorage = original.sessionStorage
    globalThis.URL = original.URL
  }
}

function createSampleCase () {
  return {
    meta: {
      sagsnummer: 'SAMPLE-100',
      kunde: 'Kunde A/S',
      adresse: 'Eksempelvej 1',
      navn: 'Prøvesag',
      dato: '2024-08-01',
    },
    linjer: [
      { linjeNr: 1, system: 'bosta', kategori: 'A', varenr: 'MAT-01', navn: 'Rør', enhed: 'stk', antal: 4, stkPris: 25, linjeBelob: 100 },
      { linjeNr: 2, system: 'bosta', kategori: 'B', varenr: 'MAT-02', navn: 'Kobling', enhed: 'stk', antal: 2, stkPris: 15, linjeBelob: 30 },
    ],
    extraInputs: {
      km: 5,
    },
    extras: {
      kmBelob: 50,
    },
    akkord: {
      ekstraarbejde: [],
      totalMaterialer: 130,
      totalAkkord: 180,
    },
  }
}

function createRoundtripSnapshot () {
  const materials = [
    { id: 'MAT-01', name: 'Rør', quantity: 4, price: 25, system: 'bosta' },
    { id: 'MAT-02', name: 'Kobling', quantity: 2, price: 15, system: 'bosta' },
    { id: 'MAT-03', name: 'Plade', quantity: 1, price: 200, system: 'alfix' },
  ];
  const linjer = materials.map((item, index) => ({
    linjeNr: index + 1,
    system: item.system,
    kategori: 'TEST',
    varenr: item.id,
    navn: item.name,
    enhed: 'stk',
    antal: item.quantity,
    stkPris: item.price,
    linjeBelob: item.quantity * item.price,
  }));

  return {
    sagsinfo: {
      sagsnummer: 'ROUND-200',
      navn: 'Runde sag',
      adresse: 'Testvej 2',
      kunde: 'Bygherre B',
      dato: '2024-09-02',
      montoer: 'Montør A',
    },
    meta: {
      sagsnummer: 'ROUND-200',
      navn: 'Runde sag',
      adresse: 'Testvej 2',
      kunde: 'Bygherre B',
      dato: '2024-09-02',
      systems: ['bosta', 'alfix'],
      jobType: 'montage',
    },
    systems: ['bosta', 'alfix'],
    linjer,
    materials,
    labor: [
      { type: 'montage', hours: 8, rate: 310, udd: 'AU', mentortillaeg: 12 },
      { type: 'demontage', hours: 2, rate: 320, udd: '', mentortillaeg: 0 },
    ],
    extras: {
      jobType: 'montage',
      montagepris: 0,
      demontagepris: 0,
      slaebePct: 12,
      slaebeFormulaText: '12%',
      antalBoringHuller: 2,
      antalLukHuller: 1,
      antalBoringBeton: 3,
      opskydeligtRaekvaerk: 1,
      kmBelob: 75,
      kmAntal: 5,
      kmIsAmount: true,
      traelle35: 1,
      traelle50: 2,
      tralleSum: 350,
    },
    extraInputs: {
      km: 5,
      slaebePctInput: 12,
      boringHuller: 2,
      lukHuller: 1,
      boringBeton: 3,
      opskydeligt: 1,
    },
    totals: {
      totalMaterialer: 330,
      ekstraarbejde: 425,
      totalAkkord: 755,
      projektsum: 755,
    },
  }
}

function sumLineTotals (items) {
  return items.reduce((sum, item) => sum + Number(item.quantity ?? item.qty ?? 0) * Number(item.unitPrice ?? item.price ?? 0), 0)
}

test('applyImportedAkkordData rehydrates exported items payload', async t => {
  setupGlobalMocks()
  const { applyImportedAkkordData } = await import('../main.js')

  const exportModel = buildExportModel(createSampleCase())
  const payloadContent = buildAkkordJsonPayload(exportModel, exportModel.meta.caseNumber, { skipValidation: true, skipBeregn: true })
  const payload = JSON.parse(payloadContent.content)

  assert.ok(Array.isArray(payload.materials))
  assert.equal(payload.materials.length, exportModel.items.length)
  assert.equal(payload.version, '2.0')
  assert.equal(payload.jobType, 'montage')

  const snapshots = []
  const hints = []

  await applyImportedAkkordData(payload, {
    applySnapshot: async snapshot => snapshots.push(snapshot),
    persistSnapshot: () => {},
    updateActionHint: (message, variant) => hints.push({ message, variant }),
  })

  assert.equal(snapshots[0].materials.length, exportModel.items.length)
  assert.equal(sumLineTotals(snapshots[0].materials), sumLineTotals(exportModel.items))
  assert.equal(snapshots[0].totals.materials, exportModel.totals.materials)
  assert.equal(snapshots[0].totals.akkord, exportModel.totals.akkord)
  assert.equal(hints.at(-1).variant, 'success')
})

test('applyImportedAkkordData imports payloads that only contain items', async t => {
  setupGlobalMocks()
  const { applyImportedAkkordData } = await import('../main.js')

  const payload = {
    meta: { caseNumber: 'ITEMS-ONLY', system: 'alfix' },
    items: [
      { itemNumber: 'MAT-10', name: 'Plank 2,57', quantity: 4, unitPrice: 12.5, system: 'bosta' },
      { id: 'MAT-11', name: 'Spire', qty: 1, unitPrice: 5 },
    ],
    extras: { jobType: 'montage' },
    wage: { workers: [{ hours: 1, rate: 100 }] },
  }

  const snapshots = []
  const hints = []

  await applyImportedAkkordData(payload, {
    applySnapshot: async snapshot => snapshots.push(snapshot),
    persistSnapshot: () => {},
    updateActionHint: (message, variant) => hints.push({ message, variant }),
  })

  assert.equal(snapshots[0].materials.length, 2)
  const [first, second] = snapshots[0].materials
  assert.equal(first.id, 'MAT-10')
  assert.equal(first.quantity, 4)
  assert.equal(first.price, 12.5)
  assert.equal(second.id, 'MAT-11')
  assert.equal(second.system, 'alfix')
  assert.equal(hints.at(-1).variant, 'success')
})

test('applyImportedAkkordData reports an error when no material fields are present', async t => {
  setupGlobalMocks()
  const { applyImportedAkkordData } = await import('../main.js')

  const hints = []
  await assert.rejects(async () => {
    await applyImportedAkkordData({ meta: { caseNumber: 'EMPTY' } }, {
      applySnapshot: async () => {},
      persistSnapshot: () => {},
      updateActionHint: (message, variant) => hints.push({ message, variant }),
    })
  }, /Kunne ikke læse nogen linjer/)

  assert.ok(hints.some(entry => entry.variant === 'error'))
})

test('AkkordExportV2 roundtrip preserves snapshot data', async t => {
  setupGlobalMocks()
  const { applyImportedAkkordData } = await import('../main.js')

  const snapshot = createRoundtripSnapshot()
  const exportModel = buildExportModel(snapshot, { exportedAt: '2024-09-02T12:00:00Z' })
  const payload = JSON.parse(buildAkkordJsonPayload(exportModel, exportModel.meta.caseNumber, { skipValidation: true, skipBeregn: true }).content)

  const snapshots = []
  await applyImportedAkkordData(payload, {
    applySnapshot: async imported => snapshots.push(imported),
    persistSnapshot: () => {},
    updateActionHint: () => {},
  })

  const imported = snapshots[0]
  assert.equal(imported.sagsinfo.sagsnummer, snapshot.sagsinfo.sagsnummer)
  assert.equal(imported.sagsinfo.montoer, snapshot.sagsinfo.montoer)
  assert.equal(imported.materials.length, snapshot.materials.length)
  assert.equal(imported.extras.jobType, 'montage')
  assert.equal(imported.extras.kmBelob, snapshot.extras.kmBelob)
  assert.equal(imported.extras.traelle50, snapshot.extras.traelle50)
  assert.equal(imported.labor.length, snapshot.labor.length)

  const roundtripModel = buildExportModel(imported, { exportedAt: '2024-09-02T13:00:00Z' })
  const roundtripPayload = JSON.parse(buildAkkordJsonPayload(roundtripModel, roundtripModel.meta.caseNumber, { skipValidation: true, skipBeregn: true }).content)

  assert.deepEqual(roundtripPayload.info, payload.info)
  assert.equal(roundtripPayload.meta.caseNumber, payload.meta.caseNumber)
  assert.equal(roundtripPayload.extras.fields.kmBelob, payload.extras.fields.kmBelob)
  assert.equal(roundtripPayload.wage.workers.length, payload.wage.workers.length)
})

test('applyImportedAkkordData imports legacy v1 payloads', async t => {
  setupGlobalMocks()
  const { applyImportedAkkordData } = await import('../main.js')

  const payload = {
    version: '1.0',
    type: 'demontage',
    info: { sagsnummer: 'LEG-1', navn: 'Legacy sag', adresse: 'Gamlevej 4', kunde: 'Klassisk' },
    materials: [
      { id: 'LEG-MAT', name: 'Legacy rør', qty: 3, unitPrice: 10 },
    ],
    extras: { km: 30, slaebBelob: 15 },
    wage: { workers: [{ hours: 2, rate: 300, type: 'demontage' }] },
    totals: { materialsSum: 30, extrasSum: 15, projectSum: 45 },
  }

  const snapshots = []
  await applyImportedAkkordData(payload, {
    applySnapshot: async snapshot => snapshots.push(snapshot),
    persistSnapshot: () => {},
    updateActionHint: () => {},
  })

  const imported = snapshots[0]
  assert.equal(imported.sagsinfo.sagsnummer, 'LEG-1')
  assert.equal(imported.materials[0].quantity, 3)
  assert.equal(imported.extras.jobType, 'demontage')
  assert.equal(imported.labor[0].hours, 2)
})
