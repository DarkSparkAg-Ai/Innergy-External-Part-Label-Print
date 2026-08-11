const test = require('node:test');
const assert = require('node:assert');
const fixtures = require('./fixtures');

const ITEM_SELECTOR = '[data-innergy-external-labels-item]';
const TOOLBAR_BUTTON_SELECTOR = '[data-innergy-external-labels]';

function settle(window, ms = 60) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function setup(options = {}) {
  const dom = options.dom ? options.dom() : fixtures.tableGrid();
  const stub = fixtures.installChromeStub(dom.window, options);
  fixtures.loadScripts(dom.window, [
    'settings', 'barcode', 'grid', 'selection', 'ui', 'diagnostics', 'rowmenu', 'main'
  ]);
  await settle(dom.window);
  return { dom, window: dom.window, document: dom.window.document, stub };
}

function printMessages(stub) {
  return stub.sent.filter((message) => message.type === 'print');
}

function shadow(document) {
  const host = document.getElementById('innergy-external-labels-ui');
  return host ? host.shadowRoot : null;
}

const printsOk = (message) => message.type === 'print'
  ? { ok: true, data: { printed: ['7604HA2K'], missing: [], error: null } }
  : { ok: false, kind: 'unreachable' };

test('adds the action to a row menu', async () => {
  const { window, document } = await setup();

  fixtures.openRowMenu(document, 0);
  await settle(window);

  const items = document.querySelectorAll(ITEM_SELECTOR);
  assert.strictEqual(items.length, 1);
  assert.match(items[0].textContent, /Print External Labels/);
});

test('the item matches the menu it was added to', async () => {
  const { window, document } = await setup();

  const portal = fixtures.openRowMenu(document, 0);
  await settle(window);

  const item = document.querySelector(ITEM_SELECTOR);
  assert.ok(portal.contains(item), 'item should be inside the menu portal');
  assert.strictEqual(item.className, 'bp4-menu-item', 'should inherit the menu item styling');
  assert.strictEqual(item.getAttribute('role'), 'menuitem');
});

test('the cloned item gets the printer icon rather than the one it copied', async () => {
  const { window, document } = await setup();

  fixtures.openRowMenu(document, 0);
  await settle(window);

  const icon = document.querySelector(`${ITEM_SELECTOR} i`);
  assert.ok(icon, 'expected an icon');
  assert.match(icon.className, /fa-qrcode/);
  assert.doesNotMatch(icon.className, /fa-pen|fa-flag-checkered/);
});

test('prints only the part whose menu it was', async () => {
  const { window, document, stub } = await setup({ onMessage: printsOk });

  fixtures.openRowMenu(document, 2); // the Shelf: AB12
  await settle(window);
  document.querySelector(ITEM_SELECTOR).click();
  await settle(window);

  const messages = printMessages(stub);
  assert.strictEqual(messages.length, 1);
  assert.deepStrictEqual([...messages[0].partCodes], ['AB12']);
});

test('works from a row that is not selected', async () => {
  // The point of the row menu: one label without touching the checkboxes.
  const { window, document, stub } = await setup({ onMessage: printsOk });

  fixtures.openRowMenu(document, 1);
  await settle(window);
  document.querySelector(ITEM_SELECTOR).click();
  await settle(window);

  assert.strictEqual(window.InnergyLabels.selection.size(), 0, 'nothing was selected');
  assert.deepStrictEqual([...printMessages(stub)[0].partCodes], ['8102BX9L']);
});

test('a row menu does not disturb a running selection', async () => {
  const { window, document, stub } = await setup({ onMessage: printsOk });

  fixtures.showToolbar(document, 2);
  await settle(window);
  fixtures.selectRows(document, [0, 1]);
  await settle(window);

  fixtures.openRowMenu(document, 3);
  await settle(window);
  document.querySelector(ITEM_SELECTOR).click();
  await settle(window);

  // The menu printed one part; the selection is untouched.
  assert.deepStrictEqual([...printMessages(stub)[0].partCodes], ['ZZ99QQ']);
  assert.strictEqual(window.InnergyLabels.selection.size(), 2);
});

test('each newly opened menu gets its own item', async () => {
  const { window, document } = await setup();

  fixtures.openRowMenu(document, 0);
  await settle(window);
  assert.strictEqual(document.querySelectorAll(ITEM_SELECTOR).length, 1);

  fixtures.closeRowMenus(document);
  await settle(window);
  assert.strictEqual(document.querySelectorAll(ITEM_SELECTOR).length, 0);

  fixtures.openRowMenu(document, 1);
  await settle(window);
  assert.strictEqual(document.querySelectorAll(ITEM_SELECTOR).length, 1);
});

test('the second menu prints its own row, not the first one', async () => {
  const { window, document, stub } = await setup({ onMessage: printsOk });

  fixtures.openRowMenu(document, 0);
  await settle(window);
  fixtures.closeRowMenus(document);

  fixtures.openRowMenu(document, 2);
  await settle(window);
  document.querySelector(ITEM_SELECTOR).click();
  await settle(window);

  assert.deepStrictEqual([...printMessages(stub)[0].partCodes], ['AB12']);
});

test('ignores menus that no row button opened', async () => {
  // The page is full of other menus - column header menus especially. Only a
  // menu that follows a click on a row's own button is ours to touch.
  const { window, document } = await setup();

  const stray = document.createElement('div');
  stray.innerHTML = '<ul class="bp4-menu" role="menu">' +
    '<li><a class="bp4-menu-item" role="menuitem" href="#">Sort Ascending</a></li></ul>';
  document.body.appendChild(stray);
  await settle(window);

  assert.strictEqual(document.querySelectorAll(ITEM_SELECTOR).length, 0);
});

test('does not claim a menu that appears long after the click', async () => {
  const { window, document } = await setup();

  const row = document.querySelector('[data-part="0"]');
  const cell = document.createElement('td');
  cell.innerHTML = '<button data-testid="context-menu-button" type="button"></button>';
  row.appendChild(cell);
  row.querySelector('[data-testid="context-menu-button"]')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  // Well past the window in which a menu is assumed to belong to that click.
  await settle(window, 2200);

  const portal = document.createElement('div');
  portal.innerHTML = '<ul class="bp4-menu" role="menu">' +
    '<li><a class="bp4-menu-item" role="menuitem" href="#">Something else</a></li></ul>';
  document.body.appendChild(portal);
  await settle(window);

  assert.strictEqual(document.querySelectorAll(ITEM_SELECTOR).length, 0);
});

test('reports a row whose barcode cannot be read, and prints nothing', async () => {
  const { window, document, stub } = await setup({ onMessage: printsOk });

  assert.ok(fixtures.blankBarcode(document, 0));
  fixtures.openRowMenu(document, 0);
  await settle(window);
  document.querySelector(ITEM_SELECTOR).click();
  await settle(window);

  assert.strictEqual(printMessages(stub).length, 0);
  assert.match(shadow(document).textContent, /no printable barcode/i);
});

test('can be turned off without affecting the toolbar button', async () => {
  // The spec's requirement: Phase 2 must never destabilise Phase 1.
  const { window, document } = await setup({ storage: { enableRowMenu: false } });

  fixtures.showToolbar(document);
  await settle(window);
  fixtures.openRowMenu(document, 0);
  await settle(window);

  assert.strictEqual(document.querySelectorAll(ITEM_SELECTOR).length, 0, 'no menu item');
  assert.strictEqual(document.querySelectorAll(TOOLBAR_BUTTON_SELECTOR).length, 1, 'toolbar button still there');
});

test('works on the real Innergy grid shape', async () => {
  const { window, document, stub } = await setup({
    dom: fixtures.devExtremeFixedGrid,
    onMessage: printsOk
  });

  // The menu button is in the frozen overlay row; the barcode is in the other.
  fixtures.openRowMenu(document, 1);
  await settle(window);
  document.querySelector(ITEM_SELECTOR).click();
  await settle(window);

  assert.deepStrictEqual([...printMessages(stub)[0].partCodes], ['8102BX9L']);
});
