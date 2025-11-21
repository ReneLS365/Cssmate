const TRAELLE_RATE35 = 10.44;
const TRAELLE_RATE50 = 14.62;
const BORING_HULLER_RATE = 4.70;
const LUK_HULLER_RATE = 3.45;
const BORING_BETON_RATE = 11.49;
const OPSKYDELIGT_RATE = 9.67;
const KM_RATE = 2.12;

function getRawAkkordData() {
  if (typeof window !== 'undefined') {
    const rawBuilder = window.cssmateBuildAkkordDataRaw || window.cssmateBuildAkkordData;
    if (typeof rawBuilder === 'function' && rawBuilder !== buildAkkordData) {
      try {
        return rawBuilder();
      } catch (error) {
        console.error('Kunne ikke hente rå akkorddata', error);
      }
    }
  }
  const sagsnummer = document.getElementById('sagsnummer')?.value || 'ukendt';
  return {
    info: {
      sagsnummer,
      kunde: document.getElementById('kunde')?.value || '',
      adresse: document.getElementById('adresse')?.value || '',
      navn: document.getElementById('navn')?.value || '',
      dato: document.getElementById('sagsdato')?.value || new Date().toISOString().slice(0, 10),
    },
    materials: [],
    totals: {},
    extras: {},
    jobFactor: 1,
    extraInputs: {},
    tralleSum: 0,
    tralleState: {},
  };
}

function mapMaterialLines(raw, jobFactor = 1) {
  const lines = Array.isArray(raw?.materials) ? raw.materials : Array.isArray(raw?.materialer) ? raw.materialer : [];
  const selected = lines.filter(line => Number(line?.quantity ?? line?.qty ?? line?.antal) > 0);
  return selected.map((line, index) => {
    const qty = Number(line.quantity ?? line.qty ?? line.antal ?? 0);
    const basePrice = Number(line.price ?? line.stkPris ?? line.pris ?? 0) * jobFactor;
    const lineTotal = qty * basePrice;
    return {
      linjeNr: index + 1,
      system: line.system || line.systemKey || '',
      kategori: line.kategori || line.category || '',
      varenr: line.varenr || line.id || '',
      navn: line.navn || line.name || line.label || '',
      enhed: line.enhed || line.unit || 'stk',
      antal: qty,
      stkPris: basePrice,
      linjeBelob: lineTotal,
    };
  });
}

function appendExtra(list, type, antal, enhed, sats, belob, tekst = '') {
  const qty = Number(antal ?? 0);
  const amount = Number(belob ?? 0);
  if (!(qty || amount)) return;
  list.push({ type, antal: qty, enhed: enhed || '', sats: Number(sats ?? ''), belob: amount, tekst: tekst || '' });
}

function buildEkstraarbejde(raw) {
  const extras = [];
  const inputs = raw?.extraInputs || {};
  appendExtra(extras, 'Boring af huller', inputs.boringHuller, 'stk', BORING_HULLER_RATE, inputs.boringHuller * BORING_HULLER_RATE, 'Boring af huller');
  appendExtra(extras, 'Lukning af huller', inputs.lukHuller, 'stk', LUK_HULLER_RATE, inputs.lukHuller * LUK_HULLER_RATE, 'Lukning af huller');
  appendExtra(extras, 'Boring i beton', inputs.boringBeton, 'stk', BORING_BETON_RATE, inputs.boringBeton * BORING_BETON_RATE, 'Boring i beton');
  appendExtra(extras, 'Opskydeligt rækværk', inputs.opskydeligt, 'stk', OPSKYDELIGT_RATE, inputs.opskydeligt * OPSKYDELIGT_RATE, 'Opskydeligt rækværk');

  const tralleState = raw?.tralleState || {};
  const tralleSum = Number(raw?.tralleSum ?? 0);
  appendExtra(extras, 'Tralleløft', tralleState.n35 || tralleState.n50 ? (tralleState.n35 || 0) + (tralleState.n50 || 0) : 0, 'løft', '', tralleSum, 'Tralleløft');
  appendExtra(extras, 'Tralle 35', tralleState.n35, 'stk', TRAELLE_RATE35, (tralleState.n35 || 0) * TRAELLE_RATE35, 'Tralle 35');
  appendExtra(extras, 'Tralle 50', tralleState.n50, 'stk', TRAELLE_RATE50, (tralleState.n50 || 0) * TRAELLE_RATE50, 'Tralle 50');

  const extrasSource = raw?.extras || {};
  const oevrige = Number(extrasSource.oevrige ?? 0);
  if (oevrige) {
    appendExtra(extras, 'Øvrige', 1, '', oevrige, oevrige, 'Øvrige ekstraarbejde');
  }

  return extras;
}

export function buildAkkordData() {
  const raw = getRawAkkordData() || {};
  const jobFactor = Number(raw.jobFactor ?? 1) || 1;
  const linjer = mapMaterialLines(raw, jobFactor);
  const meta = raw.info || {};
  const totalMaterialer = linjer.reduce((sum, line) => sum + Number(line.linjeBelob || 0), 0);

  const inputs = raw.extraInputs || {};
  const extrasSource = raw.extras || {};

  const kmAntal = Number(inputs.km ?? extrasSource.kmAntal ?? 0) || 0;
  const kmBelob = Number(extrasSource.km ?? (kmAntal * KM_RATE)) || 0;
  const kmSats = kmAntal ? kmBelob / kmAntal : KM_RATE;
  const slaebProcent = Number(inputs.slaebePctInput ?? extrasSource.slaebePct ?? 0) || 0;
  const slaebBelob = Number(raw.slaebeBelob ?? extrasSource.slaebeBelob ?? 0) || 0;

  const ekstraarbejde = buildEkstraarbejde(raw);
  const ekstraSum = ekstraarbejde.reduce((sum, entry) => sum + Number(entry.belob || 0), 0);

  const totals = raw.totals || {};
  const totalAkkord = Number(
    totals.projektsum
    ?? totals.samletAkkordsum
    ?? totals.akkordsum
    ?? totals.totalAkkord
    ?? totalMaterialer + kmBelob + slaebBelob + ekstraSum,
  );

  return {
    version: 1,
    meta: {
      sagsnummer: meta.sagsnummer || meta.caseNo || 'UKENDT',
      kunde: meta.kunde || meta.customer || '',
      adresse: meta.adresse || meta.site || meta.address || '',
      beskrivelse: meta.navn || meta.task || '',
      dato: meta.dato || new Date().toISOString().slice(0, 10),
    },
    akkord: {
      km: kmAntal,
      kmSats,
      kmBelob,
      slaebProcent,
      slaebBelob,
      ekstraarbejde,
      totalMaterialer,
      totalAkkord,
    },
    linjer,
  };
}
