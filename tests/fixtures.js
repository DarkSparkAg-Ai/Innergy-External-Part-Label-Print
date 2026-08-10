/**
 * Synthetic Innergy-like grids.
 *
 * The real markup is not documented, so these cover the two shapes a parts
 * grid realistically takes — a semantic <table>, and a div grid with ARIA
 * roles like ag-Grid or Kendo render — plus the awkward bits the spec calls
 * out: a select-all checkbox in the header, project group headers, and a
 * toolbar that only exists while rows are selected.
 */

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const EXTENSION_DIR = path.join(__dirname, '..', 'extension');

const SCRIPTS = {
  settings: 'src/common/settings.js',
  barcode: 'src/common/barcode.js',
  grid: 'src/content/grid.js',
  ui: 'src/content/ui.js',
  diagnostics: 'src/content/diagnostics.js',
  main: 'src/content/main.js'
};

const PARTS = [
  { name: 'Door Left', barcode: 'P-24-1028-010p-2.01-7604HA2K' },
  { name: 'Door Right', barcode: 'P-24-1028-010p-2.01-8102BX9L' },
  { name: 'Shelf', barcode: 'P-24-1028-011p-3.00-AB12' },
  { name: 'Toe Kick', barcode: 'P-24-1030-002p-1.10-ZZ99QQ' }
];

/**
 * jsdom does no layout, so getClientRects() is empty for everything and the
 * production visibility check would reject the whole page. Emulate just enough
 * layout for that check to be meaningful: an element is "laid out" unless it
 * or an ancestor is display:none or [hidden].
 */
function installLayoutShim(window) {
  window.Element.prototype.getClientRects = function () {
    let node = this;
    while (node && node.nodeType === 1) {
      if (node.hasAttribute('hidden')) return [];
      const inlineDisplay = node.style && node.style.display;
      if (inlineDisplay === 'none') return [];
      node = node.parentElement;
    }
    if (!this.isConnected) return [];
    return [{ width: 120, height: 24, top: 0, left: 0, bottom: 24, right: 120 }];
  };
}

function baseDom(bodyHtml) {
  const dom = new JSDOM(
    `<!DOCTYPE html><html><body>${bodyHtml}</body></html>`,
    // pretendToBeVisual gives us requestAnimationFrame, which the injector
    // uses to coalesce mutation bursts.
    { url: 'https://app.innergy.com/#/shipping/parts', runScripts: 'outside-only', pretendToBeVisual: true }
  );
  installLayoutShim(dom.window);
  return dom;
}

function loadScripts(window, names) {
  for (const name of names) {
    const code = fs.readFileSync(path.join(EXTENSION_DIR, SCRIPTS[name]), 'utf8');
    window.eval(code);
  }
}

/** A semantic <table> grid, the simplest shape Innergy might use. */
function tableGrid() {
  const rows = PARTS.map((part, index) => `
    <tr class="k-table-row" data-part="${index}">
      <td><input type="checkbox" class="row-select"></td>
      <td>${part.name}</td>
      <td>${part.barcode}</td>
      <td>Ready</td>
    </tr>`).join('');

  const dom = baseDom(`
    <div class="page">
      <div class="toolbar-host"></div>
      <table class="k-grid">
        <thead>
          <tr>
            <th><input type="checkbox" class="select-all"></th>
            <th>Part Name</th>
            <th>Barcode</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr class="k-grouping-row group-header">
            <td colspan="4"><input type="checkbox" class="group-select"> Project 24-1028</td>
          </tr>
          ${rows}
        </tbody>
      </table>
    </div>`);

  return dom;
}

/** A div grid with ARIA roles and per-cell column ids, like ag-Grid. */
function ariaGrid() {
  const rows = PARTS.map((part, index) => `
    <div role="row" class="ag-row" data-part="${index}">
      <div role="gridcell" col-id="select"><input type="checkbox" class="row-select"></div>
      <div role="gridcell" col-id="partName">${part.name}</div>
      <div role="gridcell" col-id="barcode">${part.barcode}</div>
      <div role="gridcell" col-id="status">Ready</div>
    </div>`).join('');

  const dom = baseDom(`
    <div class="ag-root" role="grid">
      <div class="toolbar-host"></div>
      <div role="row" class="ag-header-row">
        <div role="columnheader" col-id="select"></div>
        <div role="columnheader" col-id="partName">Part Name</div>
        <div role="columnheader" col-id="barcode">Barcode</div>
        <div role="columnheader" col-id="status">Status</div>
      </div>
      <div role="row" class="ag-row-group" aria-expanded="true">
        <div role="gridcell"><input type="checkbox" class="group-select"> Project 24-1028</div>
      </div>
      ${rows}
    </div>`);

  return dom;
}

/**
 * Innergy creates the multi-edit toolbar only once a row is checked, and
 * destroys it when the selection clears. These two mimic that.
 */
function showToolbar(document) {
  const host = document.querySelector('.toolbar-host');
  host.innerHTML = `
    <div class="multi-edit-bar">
      <button type="button" class="k-button primary"><span class="k-icon k-i-pencil"></span><span class="label">CHANGE STATUS</span></button>
      <button type="button" class="k-button primary"><span class="k-icon k-i-print"></span><span class="label">PRINT PART LABELS</span></button>
    </div>`;
  return host.querySelector('.multi-edit-bar');
}

function hideToolbar(document) {
  document.querySelector('.toolbar-host').innerHTML = '';
}

function selectRows(document, indexes) {
  for (const index of indexes) {
    const row = document.querySelector(`[data-part="${index}"]`);
    row.querySelector('input[type="checkbox"]').checked = true;
  }
}

/** chrome.* stubs so the content script can run outside a real extension. */
function installChromeStub(window, options = {}) {
  const sent = [];
  const storage = Object.assign({}, options.storage);

  window.chrome = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        sent.push(message);
        const responder = options.onMessage || (() => ({ ok: false, kind: 'unreachable' }));
        if (callback) setTimeout(() => callback(responder(message)), 0);
      }
    },
    storage: {
      sync: {
        get(defaults, callback) {
          callback(Object.assign({}, defaults, storage));
        },
        set(values, callback) {
          Object.assign(storage, values);
          if (callback) callback();
        }
      },
      onChanged: { addListener() {} }
    }
  };

  return { sent, storage };
}

module.exports = {
  PARTS,
  tableGrid,
  ariaGrid,
  showToolbar,
  hideToolbar,
  selectRows,
  loadScripts,
  installChromeStub
};
