/**
 * DOM discovery for the Innergy parts grid.
 *
 * Nothing in here hard-codes an Innergy CSS class. The grid markup is not
 * documented and will change under us, so every lookup is a layered discovery:
 * strongest signal first, heuristic last, and an explicit "I could not find it"
 * rather than a wrong guess. Manual selector overrides from the options page
 * always win, so a future Innergy change can be fixed without a code release.
 */
(function (root) {
  'use strict';

  var barcode = root.InnergyLabels.barcode;

  // Text of the native buttons that live in the multi-edit toolbar. Finding one
  // of these is how we find the toolbar itself.
  var NATIVE_BUTTON_LABELS = [/^print part labels$/i, /^change status$/i];

  var BUTTON_LIKE_SELECTOR = [
    'button',
    'a[href]',
    '[role="button"]',
    'input[type="button"]',
    'input[type="submit"]',
    '[class*="btn" i]',
    '[class*="button" i]'
  ].join(',');

  var ROW_SELECTOR = [
    'tr',
    '[role="row"]',
    '[class*="grid-row" i]',
    '[class*="table-row" i]',
    '[class*="dx-data-row" i]',
    '[class*="ag-row" i]',
    '[class*="k-table-row" i]'
  ].join(',');

  var CELL_SELECTOR = [
    'td',
    'th',
    '[role="gridcell"]',
    '[role="cell"]',
    '[role="columnheader"]'
  ].join(',');

  var GRID_SELECTOR = [
    'table',
    '[role="grid"]',
    '[role="treegrid"]',
    '[class*="ag-root" i]',
    '[class*="k-grid" i]',
    '[class*="dx-datagrid" i]',
    '[class*="grid" i]'
  ].join(',');

  // Attributes various grid libraries use to name a column on the cell itself.
  var COLUMN_NAME_ATTRIBUTES = ['col-id', 'data-field', 'data-colid', 'data-column', 'aria-label', 'data-dx-column'];

  var overrides = {};

  function setOverrides(next) {
    overrides = next || {};
  }

  function isVisible(el) {
    if (!el || !el.getClientRects) return false;
    return el.getClientRects().length > 0;
  }

  function textOf(el) {
    if (!el) return '';
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function matchesAny(text, patterns) {
    return patterns.some(function (re) {
      return re.test(text);
    });
  }

  // ---------------------------------------------------------------------------
  // Toolbar
  // ---------------------------------------------------------------------------

  /**
   * Every visible button whose label is one of Innergy's native multi-edit
   * actions. Returns the innermost button-like element for each match, so we
   * clone the real button and not some wrapper div around it.
   */
  function findNativeButtons() {
    var matches = [];
    var candidates = document.querySelectorAll(BUTTON_LIKE_SELECTOR);

    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (!isVisible(el)) continue;
      var label = textOf(el) || el.getAttribute('aria-label') || el.value || '';
      if (!matchesAny(label.replace(/\s+/g, ' ').trim(), NATIVE_BUTTON_LABELS)) continue;

      // Prefer the innermost match: drop any already-collected ancestor of this one.
      matches = matches.filter(function (existing) {
        return !existing.contains(el);
      });
      var isNestedInExisting = matches.some(function (existing) {
        return el.contains(existing);
      });
      if (!isNestedInExisting) matches.push(el);
    }

    return matches;
  }

  function lowestCommonAncestor(elements) {
    if (!elements.length) return null;
    var ancestor = elements[0].parentElement;
    while (ancestor) {
      var containsAll = elements.every(function (el) {
        return ancestor.contains(el);
      });
      if (containsAll) return ancestor;
      ancestor = ancestor.parentElement;
    }
    return null;
  }

  /**
   * The multi-edit toolbar, or null when no rows are selected (it does not
   * exist in the DOM at all until then).
   *
   * @returns {{toolbar: Element, template: Element|null}|null}
   */
  function findToolbar() {
    var buttons = findNativeButtons();

    // Clone "PRINT PART LABELS" when we can: it already carries a printer icon,
    // so the injected button matches the toolbar without knowing Innergy's CSS.
    var template = buttons.filter(function (button) {
      return /print part labels/i.test(textOf(button));
    })[0] || buttons[0] || null;

    if (overrides.toolbarSelector) {
      var forced = document.querySelector(overrides.toolbarSelector);
      if (forced && isVisible(forced)) {
        return { toolbar: forced, template: template };
      }
      return null;
    }

    if (!buttons.length) return null;

    var container = buttons.length > 1 ? lowestCommonAncestor(buttons) : buttons[0].parentElement;
    if (!container) return null;

    return { toolbar: container, template: template };
  }

  // ---------------------------------------------------------------------------
  // Rows
  // ---------------------------------------------------------------------------

  function directCells(row) {
    var cells = row.querySelectorAll(':scope > ' + CELL_SELECTOR.split(',').join(', :scope > '));
    if (cells.length) return Array.prototype.slice.call(cells);
    // Some grids wrap each cell in an extra div; fall back to all descendants
    // that are not themselves containers of other cells.
    var all = Array.prototype.slice.call(row.querySelectorAll(CELL_SELECTOR));
    return all.filter(function (cell) {
      return !all.some(function (other) {
        return other !== cell && cell.contains(other);
      });
    });
  }

  /**
   * Structural rows (column headers, project group headers) carry checkboxes
   * that select many rows at once. They are not parts and must never be
   * reported as unparseable barcodes.
   */
  function isStructuralRow(row) {
    if (row.querySelector('th, [role="columnheader"]')) return true;
    if (row.closest('thead')) return true;
    if (row.hasAttribute('aria-expanded')) return true;
    var className = typeof row.className === 'string' ? row.className : '';
    return /group|header|master-detail|summary|footer|filter/i.test(className);
  }

  function checkedToggles() {
    var selector = 'input[type="checkbox"]:checked, [role="checkbox"][aria-checked="true"]';
    return Array.prototype.slice.call(document.querySelectorAll(selector)).filter(isVisible);
  }

  function rowFor(el) {
    var selector = overrides.rowSelector || ROW_SELECTOR;
    return el.closest(selector);
  }

  /**
   * Rows the user has checked, in grid order (top to bottom), with structural
   * rows removed and duplicates collapsed.
   */
  function findSelectedRows() {
    var rows = [];
    checkedToggles().forEach(function (toggle) {
      var row = rowFor(toggle);
      if (!row || !isVisible(row)) return;
      if (isStructuralRow(row)) return;
      if (rows.indexOf(row) === -1) rows.push(row);
    });

    // querySelectorAll is already document order, but a row can be reached from
    // a toggle that sits outside it; sort to be certain grid order is preserved.
    rows.sort(function (a, b) {
      var position = a.compareDocumentPosition(b);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    return rows;
  }

  // ---------------------------------------------------------------------------
  // Barcode cell
  // ---------------------------------------------------------------------------

  function gridFor(row) {
    return row.closest(GRID_SELECTOR) || document.body;
  }

  /**
   * Index of the Barcode column, found by reading the column headers.
   * Returns -1 when there is no header we can recognise.
   */
  function findBarcodeColumnIndex(row) {
    var grid = gridFor(row);
    var headerCells = grid.querySelectorAll('th, [role="columnheader"]');
    for (var i = 0; i < headerCells.length; i++) {
      if (/^barcode$/i.test(textOf(headerCells[i]))) {
        var siblings = directCells(headerCells[i].parentElement || grid);
        var index = siblings.indexOf(headerCells[i]);
        if (index !== -1) return index;
      }
    }
    return -1;
  }

  function cellNamedBarcode(cells) {
    for (var i = 0; i < cells.length; i++) {
      for (var a = 0; a < COLUMN_NAME_ATTRIBUTES.length; a++) {
        var value = cells[i].getAttribute(COLUMN_NAME_ATTRIBUTES[a]);
        if (value && /barcode/i.test(value)) return cells[i];
      }
    }
    return null;
  }

  /**
   * Read one row's barcode. Strongest signal first:
   *   1. an explicit override selector from the options page
   *   2. a cell the grid itself names "barcode"
   *   3. the column index taken from the "Barcode" header
   *   4. any cell whose text is shaped like a barcode
   *
   * @returns {string} the barcode text, or '' when the row has none
   */
  function readBarcode(row, columnIndex) {
    if (overrides.barcodeSelector) {
      var forced = row.querySelector(overrides.barcodeSelector);
      if (forced) return textOf(forced);
    }

    var cells = directCells(row);

    var named = cellNamedBarcode(cells);
    if (named && textOf(named)) return textOf(named);

    if (typeof columnIndex === 'number' && columnIndex >= 0 && columnIndex < cells.length) {
      var byIndex = textOf(cells[columnIndex]);
      if (byIndex) return byIndex;
    }

    for (var i = 0; i < cells.length; i++) {
      var text = textOf(cells[i]);
      if (barcode.looksLikeBarcode(text)) return text;
    }

    return '';
  }

  /**
   * Everything the click handler needs: the barcode of each selected row plus
   * the rows we could not read at all.
   *
   * @returns {{barcodes: string[], unreadableRows: number, rowCount: number}}
   */
  function readSelection() {
    var rows = findSelectedRows();
    if (!rows.length) {
      return { barcodes: [], unreadableRows: 0, rowCount: 0 };
    }

    var columnIndex = findBarcodeColumnIndex(rows[0]);
    var barcodes = [];
    var unreadableRows = 0;

    rows.forEach(function (row) {
      var value = readBarcode(row, columnIndex);
      if (value) {
        barcodes.push(value);
      } else {
        unreadableRows += 1;
      }
    });

    return { barcodes: barcodes, unreadableRows: unreadableRows, rowCount: rows.length };
  }

  root.InnergyLabels.grid = {
    setOverrides: setOverrides,
    findToolbar: findToolbar,
    findNativeButtons: findNativeButtons,
    findSelectedRows: findSelectedRows,
    findBarcodeColumnIndex: findBarcodeColumnIndex,
    readBarcode: readBarcode,
    readSelection: readSelection,
    directCells: directCells,
    isVisible: isVisible,
    textOf: textOf
  };
})(self);
