// Brug: const csv = buildAkkordCSV(buildAkkordData());

export function buildAkkordCSV(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('buildAkkordCSV: data mangler eller er ugyldig');
  }

  const meta = data.meta || {};
  const akkord = data.akkord || {};
  const linjer = Array.isArray(data.linjer) ? data.linjer : [];
  const ekstra = Array.isArray(akkord.ekstraarbejde) ? akkord.ekstraarbejde : [];

  const sagsnr = meta.sagsnummer || 'UKENDT';

  // Helper: CSV-escaping
  const v = (val) => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes('"') || str.includes(';') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [];

  // 1) META-blok
  lines.push('#META;FELT;VÆRDI');
  lines.push(`#META;version;${v(data.version ?? 1)}`);
  lines.push(`#META;sagsnummer;${v(meta.sagsnummer || '')}`);
  lines.push(`#META;kunde;${v(meta.kunde || '')}`);
  lines.push(`#META;adresse;${v(meta.adresse || '')}`);
  lines.push(`#META;beskrivelse;${v(meta.beskrivelse || '')}`);
  lines.push(`#META;dato;${v(meta.dato || new Date().toISOString().slice(0, 10))}`);
  lines.push(`#META;totalMaterialer;${v(akkord.totalMaterialer ?? '')}`);
  lines.push(`#META;totalAkkord;${v(akkord.totalAkkord ?? '')}`);
  lines.push('');

  // 2) MATERIALER-blok
  lines.push('TYPE;SAG;LINJENR;SYSTEM;KATEGORI;VARENR;NAVN;ENHED;ANTAL;STK_PRIS;LINJE_BELOB');
  for (const row of linjer) {
    lines.push([
      'MATERIAL',
      v(sagsnr),
      v(row.linjeNr ?? ''),
      v(row.system || ''),
      v(row.kategori || ''),
      v(row.varenr || ''),
      v(row.navn || ''),
      v(row.enhed || ''),
      v(row.antal ?? 0),
      v(row.stkPris ?? 0),
      v(row.linjeBelob ?? 0)
    ].join(';'));
  }
  lines.push('');

  // 3) KM / SLÆB / EKSTRA-blok
  lines.push('TYPE;SAG;ART;ANTAL;ENHED;SATS;BELOB;BESKRIVELSE');

  // KM-linje
  if (akkord.km != null && akkord.km !== '') {
    lines.push([
      'KM',
      v(sagsnr),
      v('Transport km'),
      v(akkord.km ?? 0),
      v('km'),
      v(akkord.kmSats ?? ''),
      v(akkord.kmBelob ?? ''),
      v('Transporttillæg (km)')
    ].join(';'));
  }

  // Slæb-linje (antal = procent som info)
  if (akkord.slaebProcent != null && akkord.slaebProcent !== '') {
    lines.push([
      'SLAEB',
      v(sagsnr),
      v('Slæb (%)'),
      v(akkord.slaebProcent ?? 0),
      v('%'),
      v(''),
      v(akkord.slaebBelob ?? ''),
      v('Slæbt materiale (procenttillæg)')
    ].join(';'));
  }

  // Ekstraarbejde-linjer
  for (const e of ekstra) {
    lines.push([
      'EKSTRA',
      v(sagsnr),
      v(e.type || 'Ekstraarbejde'),
      v(e.antal ?? 0),
      v(e.enhed || ''),
      v(e.sats ?? ''),
      v(e.belob ?? ''),
      v(e.tekst || '')
    ].join(';'));
  }

  return lines.join('\n');
}
