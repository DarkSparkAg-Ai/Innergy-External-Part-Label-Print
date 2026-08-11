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
  selection: 'src/content/selection.js',
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

// The real column list from the live Innergy shipping/parts grid. Barcode sits
// at aria-colindex 16, well inside the frozen-column placeholder's span.
const INNERGY_COLUMNS = [
  '', '', 'Name', 'Type', 'Status', 'Description', 'Material', 'Shipment Item',
  'Nest Sheet Id', 'Import Name', 'Processing Station', 'Width', 'Length',
  'Thickness', 'Engineering Index', 'Barcode', 'Subassembly Id',
  'Subassembly Type', 'Engineering Part Id', 'Nest Sheet Primary Code File Name',
  'Nest Sheet Secondary Code File Name', 'Primary Code File Name',
  'Secondary Code File Name', 'External Id', 'External Data', 'Project',
  'Project Number', 'Project Status', 'Project Manager', 'Work Order Number',
  'Work Order', 'Work Order Status', ''
];

const BARCODE_COLINDEX = INNERGY_COLUMNS.indexOf('Barcode') + 1; // 1-based: 16

/**
 * A DevExtreme grid with frozen columns, matching the live Innergy markup.
 *
 * Each logical row is rendered twice: once in the main table with all 33
 * columns, and once in a fixed overlay carrying only the frozen ones — the
 * select checkbox and the row menu — with columns 2..31 collapsed into a
 * single colspan placeholder. The checkbox the user clicks is in the overlay,
 * which has no Barcode cell; the two copies are paired by aria-rowindex.
 */
function devExtremeFixedGrid() {
  const headerCells = INNERGY_COLUMNS
    .map((name, index) => {
      // The command column carries the select-all checkbox, as DevExtreme does.
      const content = index === 0
        ? '<div class="dx-select-checkbox" role="checkbox" aria-checked="false" aria-label="Select all"></div>'
        : name;
      return `<td role="columnheader" aria-colindex="${index + 1}">${content}</td>`;
    })
    .join('');

  const mainRows = PARTS.map((part, index) => {
    const cells = INNERGY_COLUMNS.map((name, column) => {
      const colIndex = column + 1;
      let content = '';
      if (name === 'Barcode') content = part.barcode;
      else if (name === 'Name') content = part.name;
      else if (name === 'Status') content = 'Ready';
      return `<td role="gridcell" aria-colindex="${colIndex}">${content}</td>`;
    }).join('');

    return `<tr class="dx-row dx-data-row dx-row-lines" role="row" aria-rowindex="${index + 3}">${cells}</tr>`;
  }).join('');

  // The overlay: select column, one colspan placeholder, command column.
  const fixedRows = PARTS.map((part, index) => `
    <tr class="dx-row dx-data-row dx-row-lines" role="row" aria-rowindex="${index + 3}" data-part="${index}">
      <td class="dx-command-select dx-editor-cell" role="gridcell" aria-colindex="1" style="text-align: center;">
        <div class="dx-checkbox dx-select-checkbox dx-datagrid-checkbox-size" aria-label="Select row"
             role="checkbox" aria-checked="false" tabindex="0">
          <input type="hidden" value="false"><div class="dx-checkbox-container"><span class="dx-checkbox-icon"></span></div>
        </div>
      </td>
      <td colspan="30" class="dx-pointer-events-none" role="gridcell" aria-colindex="2">&nbsp;</td>
      <td aria-describedby="dx-col-93-fixed" role="gridcell" aria-colindex="32">
        <span class="bp4-popover2-target">
          <button data-testid="context-menu-button" type="button"><i class="fa fa-ellipsis-vertical"></i></button>
        </span>
      </td>
    </tr>`).join('');

  return baseDom(`
    <div class="dx-widget dx-datagrid">
      <div class="toolbar-host"></div>
      <div class="dx-datagrid-headers">
        <table><tbody>
          <tr class="dx-row dx-header-row" role="row">${headerCells}</tr>
        </tbody></table>
      </div>
      <div class="dx-datagrid-rowsview">
        <div class="dx-datagrid-content">
          <table><tbody>${mainRows}</tbody></table>
        </div>
        <div class="dx-datagrid-content dx-datagrid-content-fixed">
          <table><tbody>${fixedRows}</tbody></table>
        </div>
      </div>
    </div>`);
}

/**
 * Innergy creates the multi-edit toolbar only once a row is checked, and
 * destroys it when the selection clears. These two mimic that.
 */
/**
 * @param {number} [selectedCount] render Innergy's "N selected" indicator.
 *   It reports the whole selection, which can exceed the rows on this page.
 */
function showToolbar(document, selectedCount) {
  const host = document.querySelector('.toolbar-host');
  const indicator = typeof selectedCount === 'number'
    ? `<span class="selected-count">${selectedCount} selected</span>`
    : '';

  host.innerHTML = `
    <div class="multi-edit-bar">
      ${indicator}
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

    const input = row.querySelector('input[type="checkbox"]');
    if (input) {
      input.checked = true;
      // A real tick fires change; setting the property alone mutates nothing,
      // so without this the extension has no way to notice.
      input.dispatchEvent(new row.ownerDocument.defaultView.Event('change', { bubbles: true }));
      continue;
    }

    // DevExtreme uses a div with role=checkbox rather than a real input.
    const aria = row.querySelector('[role="checkbox"]');
    if (aria) {
      aria.setAttribute('aria-checked', 'true');
      row.classList.add('dx-selection');
      row.setAttribute('aria-selected', 'true');
      aria.dispatchEvent(new row.ownerDocument.defaultView.Event('change', { bubbles: true }));
    }
  }
}

/**
 * Swap the table grid's rows for a different page of results, the way
 * pagination does — the previous page's rows leave the DOM entirely, while
 * Innergy keeps the selection.
 */
function setPageRows(document, indexes) {
  const tbody = document.querySelector('tbody');
  const groupHeader = tbody.querySelector('.group-header');

  tbody.innerHTML = '';
  if (groupHeader) tbody.appendChild(groupHeader);

  for (const index of indexes) {
    const part = PARTS[index];
    const row = document.createElement('tr');
    row.className = 'k-table-row';
    row.setAttribute('data-part', String(index));
    row.innerHTML =
      '<td><input type="checkbox" class="row-select"></td>' +
      `<td>${part.name}</td><td>${part.barcode}</td><td>Ready</td>`;
    tbody.appendChild(row);
  }
}

/** Tick every checkbox on the page, real inputs and ARIA ones alike. */
function checkEverything(document) {
  for (const box of document.querySelectorAll('input[type="checkbox"]')) {
    box.checked = true;
  }
  for (const box of document.querySelectorAll('[role="checkbox"]')) {
    box.setAttribute('aria-checked', 'true');
  }
}

/**
 * Blank a part's Barcode cell, wherever the grid shape happens to keep it.
 * Finds it by content so it works for the frozen-column layout too.
 */
function blankBarcode(document, index) {
  const target = PARTS[index].barcode;
  for (const cell of document.querySelectorAll('td, [role="gridcell"]')) {
    if (cell.textContent.trim() === target) {
      cell.textContent = '';
      return true;
    }
  }
  return false;
}

/** chrome.* stubs so the content script can run outside a real extension. */
function installChromeStub(window, options = {}) {
  const sent = [];
  const storage = Object.assign({}, options.storage);

  const messageListeners = [];

  window.chrome = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        sent.push(message);
        const responder = options.onMessage || (() => ({ ok: false, kind: 'unreachable' }));
        if (callback) setTimeout(() => callback(responder(message)), 0);
      },
      // The content script registers a listener here so the options page can
      // request a diagnostics report without relying on a hotkey.
      onMessage: {
        addListener(listener) { messageListeners.push(listener); }
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

  /** Deliver a message to the content script the way the options page does. */
  function dispatchMessage(message) {
    let received = null;
    for (const listener of messageListeners) {
      listener(message, {}, (response) => { received = response; });
    }
    return received;
  }

  return { sent, storage, dispatchMessage };
}

module.exports = {
  PARTS,
  INNERGY_COLUMNS,
  BARCODE_COLINDEX,
  tableGrid,
  ariaGrid,
  devExtremeFixedGrid,
  showToolbar,
  hideToolbar,
  selectRows,
  setPageRows,
  checkEverything,
  blankBarcode,
  loadScripts,
  installChromeStub
};
