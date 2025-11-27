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
    '#btn-export-akkord-zip': createButton('#btn-export-akkord-zip'),
    '#btn-export-akkord-json': createButton('#btn-export-akkord-json'),
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
  const exportZipFromAkkordMock = mock.fn(() => Promise.resolve());
  const handleImportAkkordMock = mock.fn();

  setExportDependencies({
    buildAkkordData: akkordDataMock,
    exportPDFBlob: exportPDFBlobMock,
    exportZipFromAkkord: exportZipFromAkkordMock,
    handleImportAkkord: handleImportAkkordMock,
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
  assert.equal(buttons['#btn-export-akkord-zip'].listenerCount(), 1, 'ZIP button is bound');
  assert.equal(buttons['#btn-export-akkord-json'].listenerCount(), 1, 'JSON button is bound');
  assert.equal(buttons['#btn-import-akkord'].listenerCount(), 1, 'import button is bound');

  await buttons['#btn-print-akkord'].click();
  assert.equal(printSpy.mock.calls.length, 1, 'print called once');

  await buttons['#btn-export-akkord-pdf'].click();
  assert.equal(akkordDataMock.mock.calls.length, 1, 'akkord data built for PDF');
  assert.equal(exportPDFBlobMock.mock.calls.length, 1, 'PDF export invoked');
  assert.equal(downloads[0]?.download, 'custom.pdf', 'PDF download is queued');
  assert.deepEqual(actionHints[0], { message: 'PDF er gemt til din enhed.', variant: 'success' });

  await buttons['#btn-export-akkord-zip'].click();
  assert.equal(akkordDataMock.mock.calls.length, 2, 'akkord data built for ZIP');
  assert.equal(exportZipFromAkkordMock.mock.calls.length, 1, 'ZIP export invoked');
  assert.deepEqual(actionHints[1], { message: 'ZIP er klar til download.', variant: 'success' });

  await buttons['#btn-export-akkord-json'].click();
  assert.equal(akkordDataMock.mock.calls.length, 3, 'akkord data built for JSON');
  assert.equal(downloads[1]?.download, 'SA-1-Kunde-2024-05-10.json', 'JSON download is queued');
  assert.deepEqual(actionHints[2], { message: 'Akkordseddel (JSON) er gemt.', variant: 'success' });

  await buttons['#btn-import-akkord'].click();
  assert.equal(handleImportAkkordMock.mock.calls.length, 1, 'import handler invoked');
});
