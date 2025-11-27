export function handleImportAkkord() {
  const input = document.getElementById('akkordImportInput');
  if (!input) return Promise.reject(new Error('Import feltet blev ikke fundet.'));

  input.value = '';

  return new Promise((resolve, reject) => {
    const onChange = async (event) => {
      try {
        const file = event.target?.files?.[0];
        if (file) {
          if (typeof window !== 'undefined' && typeof window.cssmateHandleAkkordImport === 'function') {
            await window.cssmateHandleAkkordImport(file);
          } else {
            throw new Error('Import-handler er ikke klar.');
          }
        }
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        input.removeEventListener('change', onChange);
      }
    };

    input.addEventListener('change', onChange);
    input.click();
  });
}
