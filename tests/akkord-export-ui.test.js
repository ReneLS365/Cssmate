import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { initExportPanel, setExportDependencies } from '../js/akkord-export-ui.js'

function createButton(selector) {
  const listeners = {};
  return {
    selector,
    addEventListener(type, handler) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(handler);
    },
    async click() {
      const handlers = listeners.click || [];
      for (const handler of handlers) {
        const result = handler({ target: this });
        if (result instanceof Promise) {
          await result;
        }
      }
    },
    listenerCount(type = 'click') {
      return (listeners[type] || []).length;
    },
  };
}

test('export buttons trigger their actions correctly', async t => {
  const buttons = {
    '#btn-print-akkord': createButton('#btn-print-akkord'),
    '#btn-export-akkord-pdf': createButton('#btn-export-akkord-pdf'),
    '#btn-import-akkord': createButton('#btn-import-akkord'),
  };

  const downloads = [];
  const actionHints = [];
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  const printSpy = mock.fn();
  URL.createObjectURL = mock.fn(() => 'blob:mock-url');
  URL.revokeObjectURL = mock.fn();

  globalThis.window = {
    print: printSpy,
    cssmateUpdateActionHint: (message, variant) => {
      actionHints.push({ message, variant });
    },
  };

  globalThis.document = {
    querySelector: selector => buttons[selector] || null,
    body: {
      appendChild() {},
    },
    createElement: () => {
      const anchor = {
        href: '',
        download: '',
        click() {
          downloads.push({ href: this.href, download: this.download });
        },
        remove() {},
      };
      return anchor;
    },
  };

  const akkordDataMock = mock.fn(() => ({
    meta: { sagsnummer: 'SA-1', kunde: 'Kunde', dato: '2024-05-10' },
    materials: [],
  }));

  const pdfBlob = new Blob(['pdf']);
  const exportPDFBlobMock = mock.fn(() => Promise.resolve({ blob: pdfBlob, fileName: 'custom.pdf' }));
  const publishSharedCaseMock = mock.fn(() => Promise.resolve({ status: 'kladde' }));
  const handleImportAkkordMock = mock.fn();

  setExportDependencies({
    buildAkkordData: akkordDataMock,
    handleImportAkkord: handleImportAkkordMock,
    publishSharedCase: publishSharedCaseMock,
  });

  t.after(() => {
    setExportDependencies({});
    mock.restoreAll();
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  initExportPanel();

  assert.equal(buttons['#btn-print-akkord'].listenerCount(), 1, 'print button is bound');
  assert.equal(buttons['#btn-export-akkord-pdf'].listenerCount(), 1, 'PDF button is bound');
  assert.equal(buttons['#btn-import-akkord'].listenerCount(), 1, 'import button is bound');

  await buttons['#btn-print-akkord'].click();
  assert.equal(printSpy.mock.calls.length, 1, 'print called once');
  assert.deepEqual(actionHints[0], { message: 'Printvindue åbnet.', variant: 'success' });

  await buttons['#btn-export-akkord-pdf'].click();
  assert.equal(akkordDataMock.mock.calls.length, 1, 'akkord data built for export');
  assert.equal(exportPDFBlobMock.mock.calls.length, 0, 'PDF eksport springes over');
  assert.equal(publishSharedCaseMock.mock.calls.length, 1, 'sag publiceres til delt ledger');
  const pdfDownload = downloads.find(entry => entry.download.endsWith('.pdf'));
  const jsonDownload = downloads.find(entry => entry.download.endsWith('.json'));
  assert.ok(!pdfDownload, 'Ingen PDF download');
  assert.ok(!jsonDownload, 'Ingen JSON download');
  assert.deepEqual(actionHints[1], { message: 'Publicerer sag til fælles ledger…', variant: 'info' });
  assert.deepEqual(actionHints[2], { message: 'Kladde gemt privat. Godkend i "Delt sager" for at dele.', variant: 'success' });

  await buttons['#btn-import-akkord'].click();
  assert.equal(handleImportAkkordMock.mock.calls.length, 1, 'import handler invoked');
});

test('import button reports failures to the user', async t => {
  const buttons = {
    '#btn-import-akkord': createButton('#btn-import-akkord'),
  };

  const actionHints = [];
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;

  globalThis.window = {
    cssmateUpdateActionHint: (message, variant) => {
      actionHints.push({ message, variant });
    },
  };

  globalThis.document = {
    querySelector: selector => buttons[selector] || null,
  };

  const consoleError = mock.method(console, 'error', () => {});
  const handleImportAkkordMock = mock.fn(() => Promise.reject(new Error('boom')));

  setExportDependencies({ handleImportAkkord: handleImportAkkordMock });

  t.after(() => {
    setExportDependencies({});
    mock.restoreAll();
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  });

  initExportPanel();

  await buttons['#btn-import-akkord'].click();

  assert.equal(handleImportAkkordMock.mock.calls.length, 1, 'import handler invoked');
  assert.equal(consoleError.mock.calls.length, 1, 'import errors are logged');
  assert.deepEqual(actionHints[0], { message: 'Der opstod en fejl under importen. Prøv igen – eller kontakt kontoret. (boom)', variant: 'error' });
});
