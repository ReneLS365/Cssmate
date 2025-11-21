export function handleImportAkkord() {
  const input = document.getElementById('akkordImportInput');
  if (!input) return;

  input.value = '';
  const onChange = async (event) => {
    const file = event.target?.files?.[0];
    if (file) {
      if (typeof window !== 'undefined' && typeof window.cssmateHandleAkkordImport === 'function') {
        await window.cssmateHandleAkkordImport(file);
      } else {
        console.error('Import-handler er ikke klar.');
      }
    }
    input.removeEventListener('change', onChange);
  };

  input.addEventListener('change', onChange);
  input.click();
}
