const test = require('node:test');
const assert = require('node:assert');
const fixtures = require('./fixtures');

/** Load the discovery code into a fixture DOM and hand back its API. */
function setup(domFactory) {
  const dom = domFactory();
  fixtures.loadScripts(dom.window, ['settings', 'barcode', 'grid', 'selection']);
  return { dom, window: dom.window, document: dom.window.document, grid: dom.window.InnergyLabels.grid };
}

const SHAPES = [
  ['table grid', fixtures.tableGrid],
  ['ARIA div grid', fixtures.ariaGrid],
  ['DevExtreme frozen-column grid', fixtures.devExtremeFixedGrid]
];

for (const [shapeName, factory] of SHAPES) {
  test(`${shapeName}: no toolbar exists until a row is selected`, () => {
    const { grid } = setup(factory);
    assert.strictEqual(grid.findToolbar(), null);
  });

  test(`${shapeName}: finds the toolbar once it appears`, () => {
    const { document, grid } = setup(factory);
    const toolbar = fixtures.showToolbar(document);

    const found = grid.findToolbar();
    assert.ok(found, 'expected the toolbar to be found');
    assert.strictEqual(found.toolbar, toolbar);
  });

  test(`${shapeName}: clones PRINT PART LABELS rather than CHANGE STATUS`, () => {
    const { document, grid } = setup(factory);
    fixtures.showToolbar(document);

    // The print button carries a printer icon, so cloning it gives the
    // injected button the right look for free.
    const found = grid.findToolbar();
    assert.match(found.template.textContent, /PRINT PART LABELS/);
  });

  test(`${shapeName}: reads selected rows in grid order`, () => {
    const { document, grid } = setup(factory);
    fixtures.showToolbar(document);
    fixtures.selectRows(document, [2, 0]); // checked out of order

    const selection = grid.readSelection();
    assert.deepStrictEqual([...selection.barcodes], [
      'P-24-1028-010p-2.01-7604HA2K',
      'P-24-1028-011p-3.00-AB12'
    ]);
  });

  test(`${shapeName}: ignores the select-all and group-header checkboxes`, () => {
    const { document, grid } = setup(factory);
    fixtures.showToolbar(document);

    // Tick every checkbox on the page, including the structural ones.
    fixtures.checkEverything(document);

    const selection = grid.readSelection();
    assert.strictEqual(selection.rowCount, 4, 'should see the four data rows only');
    assert.strictEqual(selection.unreadableRows, 0, 'no structural row should be reported as unreadable');
    assert.strictEqual(selection.barcodes.length, 4);
  });

  test(`${shapeName}: reports rows whose barcode cell is blank`, () => {
    const { document, grid } = setup(factory);
    fixtures.showToolbar(document);
    fixtures.selectRows(document, [0, 1]);

    assert.ok(fixtures.blankBarcode(document, 1), 'fixture should have a barcode to blank');

    const selection = grid.readSelection();
    assert.strictEqual(selection.rowCount, 2);
    assert.strictEqual(selection.barcodes.length, 1);
    assert.strictEqual(selection.unreadableRows, 1, 'the blank row must be counted, not dropped');
  });

  test(`${shapeName}: finds the barcode even with no usable header`, () => {
    const { document, grid } = setup(factory);
    fixtures.showToolbar(document);
    fixtures.selectRows(document, [0]);

    // Strip every signal except the shape of the text itself.
    for (const header of document.querySelectorAll('th, [role="columnheader"]')) {
      header.textContent = '';
    }
    for (const cell of document.querySelectorAll('[col-id]')) {
      cell.removeAttribute('col-id');
    }

    const selection = grid.readSelection();
    assert.deepStrictEqual([...selection.barcodes], ['P-24-1028-010p-2.01-7604HA2K']);
  });

  test(`${shapeName}: an override selector wins over auto-detection`, () => {
    const { document, grid } = setup(factory);
    fixtures.showToolbar(document);
    fixtures.selectRows(document, [0]);

    const row = document.querySelector('[data-part="0"]');
    const decoy = document.createElement('span');
    decoy.className = 'real-barcode';
    decoy.textContent = 'X-1-OVERRIDDEN';
    row.appendChild(decoy);

    grid.setOverrides({ barcodeSelector: '.real-barcode' });
    assert.deepStrictEqual([...grid.readSelection().barcodes], ['X-1-OVERRIDDEN']);

    grid.setOverrides({});
  });
}

test('DevExtreme: reads the barcode from the main table, not the frozen overlay', () => {
  // The regression this whole shape exists for. The checkbox lives in an
  // overlay row whose only cells are select / colspan placeholder / row menu,
  // so reading that row alone yields nothing.
  const { document, grid } = setup(fixtures.devExtremeFixedGrid);
  fixtures.showToolbar(document);
  fixtures.selectRows(document, [0, 1]);

  const selection = grid.readSelection();
  assert.strictEqual(selection.unreadableRows, 0);
  assert.deepStrictEqual([...selection.barcodes], [
    'P-24-1028-010p-2.01-7604HA2K',
    'P-24-1028-010p-2.01-8102BX9L'
  ]);
});

test('DevExtreme: the row the checkbox sits in genuinely has no barcode', () => {
  // Guards the fixture's own fidelity — if this ever passes trivially, the
  // fixture has stopped reproducing the bug.
  const { document, grid } = setup(fixtures.devExtremeFixedGrid);
  fixtures.showToolbar(document);
  fixtures.selectRows(document, [0]);

  const overlayRow = document.querySelector('.dx-datagrid-content-fixed [data-part="0"]');
  const cells = grid.directCells(overlayRow);

  assert.strictEqual(cells.length, 3, 'overlay row should hold only the frozen columns');
  assert.ok(
    cells.every((cell) => !grid.textOf(cell).includes('7604HA2K')),
    'the overlay row must not contain the barcode'
  );
});

test('DevExtreme: pairs the two copies of a row by aria-rowindex', () => {
  const { document, grid } = setup(fixtures.devExtremeFixedGrid);
  fixtures.selectRows(document, [0]);

  const overlayRow = document.querySelector('.dx-datagrid-content-fixed [data-part="0"]');
  const related = grid.rowsSharingIndex(overlayRow);

  assert.strictEqual(related.length, 2, 'main row plus overlay row');
  assert.strictEqual(related[0], overlayRow, 'the row we started from comes first');
  assert.ok(
    related[1].closest('.dx-datagrid-content-fixed') === null,
    'the partner should be the main-table row'
  );
});

test('DevExtreme: matches the Barcode column by aria-colindex', () => {
  const { document, grid } = setup(fixtures.devExtremeFixedGrid);
  fixtures.selectRows(document, [0]);

  const row = document.querySelector('.dx-datagrid-content-fixed [data-part="0"]');
  const column = grid.findBarcodeColumn(row);

  assert.strictEqual(column.ariaColIndex, String(fixtures.BARCODE_COLINDEX));
});

test('DevExtreme: finds headers even though they are in a separate table', () => {
  const { document, grid } = setup(fixtures.devExtremeFixedGrid);
  fixtures.selectRows(document, [0]);

  const row = document.querySelector('.dx-datagrid-content-fixed [data-part="0"]');
  const root = grid.gridRootFor(row);

  assert.ok(root.querySelector('.dx-datagrid-headers'), 'grid root must span headers and rows');
  assert.ok(root.contains(row));
});

test('DevExtreme: the colspan placeholder is never mistaken for a barcode', () => {
  // The placeholder holds &nbsp; at aria-colindex 2; a naive positional read
  // would happily return it.
  const { document, grid } = setup(fixtures.devExtremeFixedGrid);
  fixtures.selectRows(document, [0]);

  const overlayRow = document.querySelector('.dx-datagrid-content-fixed [data-part="0"]');
  const placeholder = overlayRow.querySelector('.dx-pointer-events-none');

  assert.strictEqual(grid.textOf(placeholder), '', 'nbsp should read as empty');
  assert.strictEqual(
    grid.readBarcode(overlayRow, grid.findBarcodeColumn(overlayRow)),
    'P-24-1028-010p-2.01-7604HA2K'
  );
});

test('DevExtreme: falls back to barcode-shaped text when the header is renamed', () => {
  const { document, grid } = setup(fixtures.devExtremeFixedGrid);
  fixtures.selectRows(document, [2]);

  for (const header of document.querySelectorAll('[role="columnheader"]')) {
    header.textContent = 'Renamed';
  }

  assert.deepStrictEqual(
    [...grid.readSelection().barcodes],
    ['P-24-1028-011p-3.00-AB12']
  );
});

test('the rows container is never mistaken for a row', () => {
  // dx-datagrid-rowsview holds every row and its class contains the substring
  // "grid-row". Treated as a row, it reads as the first barcode in the whole
  // grid — so a single-row print could label the wrong part.
  const { grid } = setup(fixtures.devExtremeFixedGrid);
  const rows = grid.findDataRows();

  assert.ok(rows.length > 0, 'expected some rows');
  for (const row of rows) {
    assert.ok(
      !String(row.className).includes('rowsview'),
      `the rows container leaked into findDataRows: ${row.className}`
    );
  }
});

test('no returned row contains another row', () => {
  for (const [, factory] of SHAPES) {
    const { grid } = setup(factory);
    const rows = grid.findDataRows();
    for (const row of rows) {
      const nested = rows.filter((other) => other !== row && row.contains(other));
      assert.strictEqual(nested.length, 0, 'a container was returned as a row');
    }
  }
});

test('table grid: uses the Barcode header to pick the column', () => {
  const { document, grid } = setup(fixtures.tableGrid);
  fixtures.showToolbar(document);
  fixtures.selectRows(document, [0]);

  const row = document.querySelector('[data-part="0"]');
  assert.strictEqual(grid.findBarcodeColumnIndex(row), 2);
});

test('ARIA grid: uses the col-id attribute to pick the cell', () => {
  const { document, grid } = setup(fixtures.ariaGrid);
  fixtures.showToolbar(document);
  fixtures.selectRows(document, [1]);

  // Blank the headers so only the cell attribute can identify the column.
  for (const header of document.querySelectorAll('[role="columnheader"]')) {
    header.textContent = '';
  }

  assert.deepStrictEqual([...grid.readSelection().barcodes], ['P-24-1028-010p-2.01-8102BX9L']);
});

test('ignores checkboxes in a hidden part of the page', () => {
  const { document, grid } = setup(fixtures.tableGrid);
  fixtures.showToolbar(document);
  fixtures.selectRows(document, [0]);

  const hidden = document.createElement('div');
  hidden.setAttribute('hidden', '');
  hidden.innerHTML = '<table><tbody><tr class="k-table-row">' +
    '<td><input type="checkbox" checked></td><td>Ghost</td><td>P-9-9-GHOST1</td>' +
    '</tr></tbody></table>';
  document.body.appendChild(hidden);

  const selection = grid.readSelection();
  assert.deepStrictEqual([...selection.barcodes], ['P-24-1028-010p-2.01-7604HA2K']);
});

test('empty selection reports zero rows rather than throwing', () => {
  const { document, grid } = setup(fixtures.tableGrid);
  fixtures.showToolbar(document);

  const selection = grid.readSelection();
  assert.strictEqual(selection.rowCount, 0);
  assert.strictEqual(selection.barcodes.length, 0);
});

test('toolbar is not found when Innergy renames its buttons', () => {
  // A rename is the realistic way this breaks. It must fail closed — no
  // toolbar, no button — rather than attaching to something arbitrary.
  const { document, grid } = setup(fixtures.tableGrid);
  fixtures.showToolbar(document);
  for (const button of document.querySelectorAll('.k-button .label')) {
    button.textContent = 'SOMETHING ELSE';
  }
  assert.strictEqual(grid.findToolbar(), null);
});
