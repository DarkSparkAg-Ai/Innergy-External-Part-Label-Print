const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const fixtures = require('./fixtures');

const BUTTON_SELECTOR = '[data-innergy-external-labels]';

function settle(window, ms = 60) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function setup(options = {}) {
  const dom = options.dom ? options.dom() : fixtures.tableGrid();
  const stub = fixtures.installChromeStub(dom.window, options);
  fixtures.loadScripts(dom.window, ['settings', 'barcode', 'grid', 'selection', 'ui', 'diagnostics', 'main']);
  await settle(dom.window);
  return { dom, window: dom.window, document: dom.window.document, stub };
}

function injectedButtons(document) {
  return document.querySelectorAll(BUTTON_SELECTOR);
}

function printMessages(stub) {
  return stub.sent.filter((message) => message.type === 'print');
}

function shadow(document) {
  const host = document.getElementById('innergy-external-labels-ui');
  return host ? host.shadowRoot : null;
}

test('no button before the toolbar exists', async () => {
  const { document } = await setup();
  assert.strictEqual(injectedButtons(document).length, 0);
});

test('injects the button when the toolbar appears', async () => {
  const { window, document } = await setup();

  fixtures.showToolbar(document);
  await settle(window);

  const buttons = injectedButtons(document);
  assert.strictEqual(buttons.length, 1);
  assert.match(buttons[0].textContent, /Print External Labels/);
});

test('the injected button sits inside the toolbar next to the native ones', async () => {
  const { window, document } = await setup();

  const toolbar = fixtures.showToolbar(document);
  await settle(window);

  const button = document.querySelector(BUTTON_SELECTOR);
  assert.ok(toolbar.contains(button), 'button should be inside the multi-edit toolbar');
  assert.strictEqual(button.className, 'k-button primary', 'should inherit the native button styling');
});

test('re-injects after the toolbar is destroyed and recreated', async () => {
  // This is the trap the spec calls out: a one-shot lookup at page load
  // silently does nothing, because the toolbar is created and destroyed with
  // the selection.
  const { window, document } = await setup();

  fixtures.showToolbar(document);
  await settle(window);
  assert.strictEqual(injectedButtons(document).length, 1, 'first appearance');

  fixtures.hideToolbar(document);
  await settle(window);
  assert.strictEqual(injectedButtons(document).length, 0, 'toolbar destroyed');

  fixtures.showToolbar(document);
  await settle(window);
  assert.strictEqual(injectedButtons(document).length, 1, 'second appearance');
});

test('does not inject twice when the page mutates repeatedly', async () => {
  const { window, document } = await setup();

  fixtures.showToolbar(document);
  await settle(window);

  for (let i = 0; i < 5; i++) {
    document.body.appendChild(document.createElement('div'));
  }
  await settle(window);

  assert.strictEqual(injectedButtons(document).length, 1);
});

test('stays off routes that are not configured', async () => {
  const { window, document } = await setup({ storage: { routePatterns: ['#/production/parts'] } });

  fixtures.showToolbar(document);
  await settle(window);

  assert.strictEqual(injectedButtons(document).length, 0);
});

test('appears after navigating to a configured route', async () => {
  const { window, document } = await setup({ storage: { routePatterns: ['#/shipping/parts'] } });

  window.location.hash = '#/somewhere/else';
  fixtures.showToolbar(document);
  await settle(window);
  assert.strictEqual(injectedButtons(document).length, 0, 'wrong route');

  window.location.hash = '#/shipping/parts';
  await settle(window);
  assert.strictEqual(injectedButtons(document).length, 1, 'back on the parts grid');
});

test('warns and sends nothing when no rows are selected', async () => {
  const { window, document, stub } = await setup();

  fixtures.showToolbar(document);
  await settle(window);
  document.querySelector(BUTTON_SELECTOR).click();
  await settle(window);

  assert.strictEqual(printMessages(stub).length, 0, 'must not contact the helper');
  assert.match(shadow(document).textContent, /No rows selected/);
});

test('sends deduped part codes in grid order', async () => {
  const { window, document, stub } = await setup({
    onMessage: (message) => message.type === 'print'
      ? { ok: true, data: { printed: ['7604HA2K', 'AB12'], missing: [], error: null } }
      : { ok: false, kind: 'unreachable' }
  });

  fixtures.showToolbar(document);
  await settle(window);
  fixtures.selectRows(document, [2, 0]);
  document.querySelector(BUTTON_SELECTOR).click();
  await settle(window);

  const messages = printMessages(stub);
  assert.strictEqual(messages.length, 1);
  assert.deepStrictEqual([...messages[0].partCodes], ['7604HA2K', 'AB12']);
  assert.match(shadow(document).textContent, /Printed 2 labels/);
});

test('reports missing label files without hiding what did print', async () => {
  const { window, document } = await setup({
    onMessage: (message) => message.type === 'print'
      ? { ok: true, data: { printed: ['7604HA2K'], missing: ['8102BX9L'], error: null } }
      : { ok: false, kind: 'unreachable' }
  });

  fixtures.showToolbar(document);
  await settle(window);
  fixtures.selectRows(document, [0, 1]);
  document.querySelector(BUTTON_SELECTOR).click();
  await settle(window);

  const text = shadow(document).textContent;
  assert.match(text, /Printed 1 of 2 labels/);
  assert.match(text, /8102BX9L\.bmp/);
});

test('tells the user plainly when the helper is not running', async () => {
  const { window, document } = await setup({
    onMessage: () => ({ ok: false, kind: 'unreachable', error: 'connection refused' })
  });

  fixtures.showToolbar(document);
  await settle(window);
  fixtures.selectRows(document, [0]);
  document.querySelector(BUTTON_SELECTOR).click();
  await settle(window);

  assert.match(shadow(document).textContent, /helper is not running/i);
});

test('distinguishes an unreachable folder from a missing file', async () => {
  const { window, document } = await setup({
    onMessage: (message) => message.type === 'print'
      ? { ok: true, data: { printed: [], missing: [], error: 'nope', errorCode: 'FOLDER_UNREACHABLE' } }
      : { ok: false, kind: 'unreachable' }
  });

  fixtures.showToolbar(document);
  await settle(window);
  fixtures.selectRows(document, [0]);
  document.querySelector(BUTTON_SELECTOR).click();
  await settle(window);

  const text = shadow(document).textContent;
  assert.match(text, /folder is not reachable/i);
  assert.match(text, /mapped drive/i);
});

test('reports a missing printer loudly', async () => {
  const { window, document } = await setup({
    onMessage: (message) => message.type === 'print'
      ? { ok: true, data: { printed: [], missing: [], error: 'nope', errorCode: 'PRINTER_NOT_FOUND' } }
      : { ok: false, kind: 'unreachable' }
  });

  fixtures.showToolbar(document);
  await settle(window);
  fixtures.selectRows(document, [0]);
  document.querySelector(BUTTON_SELECTOR).click();
  await settle(window);

  assert.match(shadow(document).textContent, /printer was not found/i);
});

test('confirms before printing over the threshold, and cancelling sends nothing', async () => {
  const { window, document, stub } = await setup({ storage: { warnThreshold: 1 } });

  fixtures.showToolbar(document);
  await settle(window);
  fixtures.selectRows(document, [0, 1]);
  document.querySelector(BUTTON_SELECTOR).click();
  await settle(window);

  const dialog = shadow(document).querySelector('.dialog');
  assert.ok(dialog, 'expected a confirm dialog');
  assert.match(dialog.textContent, /Print 2 labels\?/);
  assert.strictEqual(printMessages(stub).length, 0, 'nothing sent before confirming');

  dialog.querySelector('.cancel').click();
  await settle(window);
  assert.strictEqual(printMessages(stub).length, 0, 'cancel must not print');
  assert.strictEqual(shadow(document).querySelector('.dialog'), null, 'dialog should close');
});

test('confirming the dialog goes ahead and prints', async () => {
  const { window, document, stub } = await setup({
    storage: { warnThreshold: 1 },
    onMessage: (message) => message.type === 'print'
      ? { ok: true, data: { printed: ['7604HA2K', '8102BX9L'], missing: [], error: null } }
      : { ok: false, kind: 'unreachable' }
  });

  fixtures.showToolbar(document);
  await settle(window);
  fixtures.selectRows(document, [0, 1]);
  document.querySelector(BUTTON_SELECTOR).click();
  await settle(window);

  shadow(document).querySelector('.dialog .confirm').click();
  await settle(window);

  assert.strictEqual(printMessages(stub).length, 1);
});

test("the helper's threshold overrides the extension's", async () => {
  // One place to change it for the whole shop: config.json on the machine.
  const { window, document } = await setup({
    storage: { warnThreshold: 100 },
    onMessage: (message) => message.type === 'health'
      ? { ok: true, data: { warnThreshold: 1 } }
      : { ok: true, data: { printed: [], missing: [], error: null } }
  });

  fixtures.showToolbar(document);
  await settle(window);
  fixtures.selectRows(document, [0, 1]);
  document.querySelector(BUTTON_SELECTOR).click();
  await settle(window);

  assert.ok(shadow(document).querySelector('.dialog'), 'helper threshold of 1 should trigger the confirm');
});

test('clicking the button does not trigger Innergy\'s own handler', async () => {
  const { window, document } = await setup();

  const toolbar = fixtures.showToolbar(document);
  await settle(window);

  let nativeClicks = 0;
  toolbar.addEventListener('click', () => { nativeClicks++; });

  document.querySelector(BUTTON_SELECTOR).click();
  await settle(window);

  assert.strictEqual(nativeClicks, 0, 'the click must not bubble to Innergy');
});

test('end to end on the real Innergy grid shape', async () => {
  // The live grid: DevExtreme with frozen columns, so the checkbox and the
  // barcode live in different DOM rows.
  const { window, document, stub } = await setup({
    dom: fixtures.devExtremeFixedGrid,
    onMessage: (message) => message.type === 'print'
      ? { ok: true, data: { printed: ['7604HA2K', 'AB12'], missing: [], error: null } }
      : { ok: false, kind: 'unreachable' }
  });

  fixtures.showToolbar(document);
  await settle(window);
  fixtures.selectRows(document, [2, 0]);

  document.querySelector(BUTTON_SELECTOR).click();
  await settle(window);

  const messages = printMessages(stub);
  assert.strictEqual(messages.length, 1);
  assert.deepStrictEqual([...messages[0].partCodes], ['7604HA2K', 'AB12']);
  assert.match(shadow(document).textContent, /Printed 2 labels/);
});

test('diagnostics report both copies of a frozen-column row', async () => {
  const { window, document, stub } = await setup({ dom: fixtures.devExtremeFixedGrid });

  fixtures.showToolbar(document);
  await settle(window);
  fixtures.selectRows(document, [0]);

  const response = stub.dispatchMessage({ type: 'diagnostics' });
  assert.ok(response && response.ok);
  assert.match(response.report, /DOM rows representing the first selected row: 2/);
  assert.match(response.report, /aria-colindex: 16/);
  assert.match(response.report, /7604HA2K/);
});

test('keeps a selection made across two pages', async () => {
  // The reported bug: two parts ticked on page 1, two more on page 2. The
  // page 1 rows are long gone from the DOM by print time.
  const { window, document, stub } = await setup({
    onMessage: (message) => message.type === 'print'
      ? { ok: true, data: { printed: ['7604HA2K', '8102BX9L', 'AB12', 'ZZ99QQ'], missing: [], error: null } }
      : { ok: false, kind: 'unreachable' }
  });

  fixtures.setPageRows(document, [0, 1]);
  fixtures.showToolbar(document, 2);
  await settle(window);
  fixtures.selectRows(document, [0, 1]);
  await settle(window);

  // Page 2: previous rows leave the DOM, Innergy keeps the selection.
  fixtures.setPageRows(document, [2, 3]);
  fixtures.showToolbar(document, 4);
  await settle(window);
  fixtures.selectRows(document, [2, 3]);
  await settle(window);

  assert.strictEqual(document.querySelectorAll('[data-part="0"]').length, 0, 'page 1 rows are gone');

  document.querySelector(BUTTON_SELECTOR).click();
  await settle(window);

  assert.strictEqual(shadow(document).querySelector('.dialog'), null, 'counts agree, so no warning');

  const messages = printMessages(stub);
  assert.strictEqual(messages.length, 1);
  assert.deepStrictEqual([...messages[0].partCodes], ['7604HA2K', '8102BX9L', 'AB12', 'ZZ99QQ']);
});

test('unticking a row on the current page drops it from the selection', async () => {
  const { window, document, stub } = await setup({
    onMessage: (message) => message.type === 'print'
      ? { ok: true, data: { printed: ['7604HA2K'], missing: [], error: null } }
      : { ok: false, kind: 'unreachable' }
  });

  fixtures.showToolbar(document, 2);
  await settle(window);
  fixtures.selectRows(document, [0, 1]);
  await settle(window);

  document.querySelector('[data-part="1"] input[type="checkbox"]').checked = false;
  fixtures.showToolbar(document, 1);
  await settle(window);

  document.querySelector(BUTTON_SELECTOR).click();
  await settle(window);

  const messages = printMessages(stub);
  assert.strictEqual(messages.length, 1);
  assert.deepStrictEqual([...messages[0].partCodes], ['7604HA2K']);
});

test('clearing the selection empties the running set', async () => {
  const { window, document, stub } = await setup();

  fixtures.showToolbar(document, 2);
  await settle(window);
  fixtures.selectRows(document, [0, 1]);
  await settle(window);
  assert.strictEqual(window.InnergyLabels.selection.size(), 2);

  // Innergy removes the toolbar and the indicator when the selection clears.
  for (const box of document.querySelectorAll('input[type="checkbox"]')) box.checked = false;
  fixtures.hideToolbar(document);
  await settle(window);

  assert.strictEqual(window.InnergyLabels.selection.size(), 0);
  assert.strictEqual(printMessages(stub).length, 0);
});

test('warns when rows were selected before the extension could see them', async () => {
  // Reloading the page with a selection already active: Innergy reports 4,
  // but we never saw two of them being ticked.
  const { window, document, stub } = await setup();

  fixtures.showToolbar(document, 4);
  await settle(window);
  fixtures.selectRows(document, [0, 1]);
  await settle(window);

  document.querySelector(BUTTON_SELECTOR).click();
  await settle(window);

  const dialog = shadow(document).querySelector('.dialog');
  assert.ok(dialog, 'expected a confirm dialog');
  assert.match(dialog.textContent, /Only 2 of 4 selected parts could be read/);
  assert.strictEqual(printMessages(stub).length, 0, 'nothing sent before the user decides');
});

test('warns when the recorded selection outruns what Innergy reports', async () => {
  const { window, document, stub } = await setup();

  fixtures.showToolbar(document, 2);
  await settle(window);
  fixtures.selectRows(document, [0, 1]);
  await settle(window);

  // Innergy now reports fewer than we hold, so our record is stale.
  fixtures.showToolbar(document, 1);
  await settle(window);

  document.querySelector(BUTTON_SELECTOR).click();
  await settle(window);

  const dialog = shadow(document).querySelector('.dialog');
  assert.ok(dialog, 'expected a confirm dialog');
  assert.match(dialog.textContent, /Selection may be out of date/);
  assert.strictEqual(printMessages(stub).length, 0);
});

test('cancelling the cross-page warning prints nothing', async () => {
  const { window, document, stub } = await setup();

  fixtures.showToolbar(document, 4);
  await settle(window);
  fixtures.selectRows(document, [0, 1]);
  document.querySelector(BUTTON_SELECTOR).click();
  await settle(window);

  shadow(document).querySelector('.dialog .cancel').click();
  await settle(window);

  assert.strictEqual(printMessages(stub).length, 0);
});

test('confirming the cross-page warning prints the visible rows', async () => {
  const { window, document, stub } = await setup({
    onMessage: (message) => message.type === 'print'
      ? { ok: true, data: { printed: ['7604HA2K', '8102BX9L'], missing: [], error: null } }
      : { ok: false, kind: 'unreachable' }
  });

  fixtures.showToolbar(document, 4);
  await settle(window);
  fixtures.selectRows(document, [0, 1]);
  document.querySelector(BUTTON_SELECTOR).click();
  await settle(window);

  shadow(document).querySelector('.dialog .confirm').click();
  await settle(window);

  const messages = printMessages(stub);
  assert.strictEqual(messages.length, 1);
  assert.deepStrictEqual([...messages[0].partCodes], ['7604HA2K', '8102BX9L']);
});

test('no warning when the whole selection is on this page', async () => {
  const { window, document, stub } = await setup({
    onMessage: (message) => message.type === 'print'
      ? { ok: true, data: { printed: ['7604HA2K', '8102BX9L'], missing: [], error: null } }
      : { ok: false, kind: 'unreachable' }
  });

  fixtures.showToolbar(document, 2);
  await settle(window);
  fixtures.selectRows(document, [0, 1]);
  document.querySelector(BUTTON_SELECTOR).click();
  await settle(window);

  assert.strictEqual(shadow(document).querySelector('.dialog'), null, 'no dialog expected');
  assert.strictEqual(printMessages(stub).length, 1, 'should print without interruption');
});

test('reads Innergy\'s selected-count indicator', async () => {
  const { window, document } = await setup();
  fixtures.showToolbar(document, 17);
  await settle(window);

  assert.strictEqual(window.InnergyLabels.grid.findSelectedCount(), 17);
});

test('no indicator on the page means no false warning', async () => {
  const { window, document, stub } = await setup({
    onMessage: (message) => message.type === 'print'
      ? { ok: true, data: { printed: ['7604HA2K'], missing: [], error: null } }
      : { ok: false, kind: 'unreachable' }
  });

  fixtures.showToolbar(document); // no indicator rendered
  await settle(window);
  fixtures.selectRows(document, [0]);
  document.querySelector(BUTTON_SELECTOR).click();
  await settle(window);

  assert.strictEqual(shadow(document).querySelector('.dialog'), null);
  assert.strictEqual(printMessages(stub).length, 1);
});

test('diagnostics can be collected without the hotkey', async () => {
  // Another extension can claim Ctrl+Shift+L, so the options page asks the
  // content script directly. That path must work with the hotkey disabled.
  const { window, document, stub } = await setup({ storage: { enableDiagnosticsHotkey: false } });

  fixtures.showToolbar(document);
  await settle(window);
  fixtures.selectRows(document, [0, 1]);

  const response = stub.dispatchMessage({ type: 'diagnostics' });

  assert.ok(response && response.ok, 'the content script should answer');
  assert.match(response.report, /selector diagnostics/i);
  assert.match(response.report, /count: 2/, 'should report the selected rows');
  assert.match(response.report, /7604HA2K/, 'should report the parsed part codes');
  assert.match(response.url, /app\.innergy\.com/);
});

test('diagnostics work even where no button was injected', async () => {
  // The most useful case: the button is missing and we need to know why.
  const { window, document, stub } = await setup({ storage: { routePatterns: ['#/somewhere/else'] } });

  fixtures.showToolbar(document);
  await settle(window);
  assert.strictEqual(injectedButtons(document).length, 0, 'no button on this route');

  const response = stub.dispatchMessage({ type: 'diagnostics' });
  assert.ok(response && response.ok);
  assert.match(response.report, /Toolbar/);
});

test('a selection of only unparseable barcodes prints nothing', async () => {
  const { window, document, stub } = await setup();

  fixtures.showToolbar(document);
  await settle(window);

  // Garble the barcode before it is ticked, the way a bad row would arrive.
  const row = document.querySelector('[data-part="0"]');
  row.querySelectorAll('td')[2].textContent = 'GARBAGE';
  fixtures.selectRows(document, [0]);
  await settle(window);

  document.querySelector(BUTTON_SELECTOR).click();
  await settle(window);

  assert.strictEqual(printMessages(stub).length, 0);

  const text = shadow(document).textContent;
  assert.match(text, /No printable barcodes/);

  // Must not send the user to a shortcut another extension may have claimed.
  assert.doesNotMatch(text, /Ctrl\+Shift/i, 'should not point at the hotkey');
  assert.match(text, /Collect diagnostics/i, 'should point at the options page button');
});

test('no user-facing message tells the user to press the hotkey', async () => {
  // Guards every toast at once: the hotkey is optional and collidable, so it
  // must never be the instruction we give when something has gone wrong.
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'extension', 'src', 'content', 'main.js'),
    'utf8'
  );

  const userFacingLines = source
    .split('\n')
    .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'));

  assert.ok(
    !/Ctrl\+Shift/i.test(userFacingLines.join('\n')),
    'main.js still instructs the user to press a hotkey'
  );
});
