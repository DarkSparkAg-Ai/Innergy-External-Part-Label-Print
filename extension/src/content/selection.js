/**
 * The running selection, accumulated across pages.
 *
 * Innergy keeps a selection while you paginate and refilter, but only the
 * current page's rows exist in the DOM — so reading the DOM at print time sees
 * whatever page you happen to be on and silently prints short.
 *
 * Instead, every time the grid changes, the rows on screen are folded into a
 * running set: a row that is ticked gets recorded there and then, while its
 * barcode is readable. Paginate away and the row leaves the DOM, but the
 * barcode stays recorded. Untick a row and it is dropped again.
 *
 * This deliberately does not reach into Innergy's own selection model. That
 * model is not reachable without walking React and DevExtreme internals, which
 * would break far more easily than reading the DOM. Innergy's "N selected"
 * indicator is used as an independent check instead: if it disagrees with what
 * we recorded, the user is told rather than handed a short batch.
 */
(function (root) {
  'use strict';

  var grid = root.InnergyLabels.grid;

  var order = [];                  // barcodes, in the order they were first seen
  var known = Object.create(null);

  // Barcodes are deliberately re-read every pass rather than cached per row.
  // Grids recycle row elements for different data as you page, and a cache
  // entry that outlived its row would print a label for the wrong part - far
  // worse than the cost of re-reading one cell per rendered row.

  function add(barcode) {
    if (known[barcode]) return;
    known[barcode] = true;
    order.push(barcode);
  }

  function remove(barcode) {
    if (!known[barcode]) return;
    delete known[barcode];
    var at = order.indexOf(barcode);
    if (at !== -1) order.splice(at, 1);
  }

  function reset() {
    order = [];
    known = Object.create(null);
  }

  /**
   * Group the rendered rows by logical row, so the two copies of a
   * frozen-column row are considered together: the checkbox is in one, the
   * barcode in the other.
   */
  function groupRows(rows) {
    var groups = new Map();

    rows.forEach(function (row) {
      var rowIndex = grid.rowIndexOf(row);
      // Rows without an index attribute stand alone; the element is the key.
      var key = rowIndex === null ? row : 'row:' + rowIndex;

      var group = groups.get(key);
      if (!group) {
        group = [];
        groups.set(key, group);
      }
      group.push(row);
    });

    return groups;
  }

  /** Fold the rows currently on screen into the running selection. */
  function sync() {
    // The toolbar exists only while something is selected, so its absence -
    // with nothing ticked on screen either - means the selection was cleared.
    if (!grid.findToolbar() && !grid.findSelectedRows().length) {
      reset();
      return;
    }

    var rows = grid.findDataRows();
    if (!rows.length) return;

    var column = grid.findBarcodeColumn(rows[0]);

    // Map iteration follows insertion order, which is document order here, so
    // rows accumulate top to bottom within a page and page by page after that.
    groupRows(rows).forEach(function (group) {
      var value = '';
      for (var i = 0; i < group.length && !value; i++) {
        value = grid.readBarcodeFromRow(group[i], column);
      }
      if (!value) return;

      if (group.some(grid.isRowChecked)) {
        add(value);
      } else {
        remove(value);
      }
    });
  }

  root.InnergyLabels.selection = {
    sync: sync,
    reset: reset,
    list: function () { return order.slice(); },
    size: function () { return order.length; }
  };
})(self);
