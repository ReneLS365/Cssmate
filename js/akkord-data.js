export function buildAkkordData(...args) {
  if (typeof window !== 'undefined' && typeof window.cssmateBuildAkkordData === 'function') {
    try {
      return window.cssmateBuildAkkordData(...args);
    } catch (error) {
      console.error('Kunne ikke hente akkorddata fra app-state', error);
    }
  }

  const sagsnummer = document.getElementById('sagsnummer')?.value || 'ukendt';

  return {
    version: 1,
    meta: {
      sagsnummer,
      dato: new Date().toISOString(),
    },
    akkord: {},
    linjer: [],
  };
}
