const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

function loadBarcodeModule() {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'extension', 'src', 'common', 'barcode.js'),
    'utf8'
  );
  // Evaluated in this realm rather than via vm, so the arrays it returns are
  // ordinary host arrays that deepStrictEqual will accept.
  const root = {};
  new Function('self', code)(root);
  return root.InnergyLabels.barcode;
}

const barcode = loadBarcodeModule();

test('takes the part code from after the final dash', () => {
  assert.strictEqual(barcode.parsePartCode('P-24-1028-010p-2.01-7604HA2K').partCode, '7604HA2K');
});

test('is not confused by dashes in the work order', () => {
  // The WO contains dashes; only the last one separates the PartCode.
  assert.strictEqual(barcode.parsePartCode('P-24-1030-002p-1.10-ZZ99QQ').partCode, 'ZZ99QQ');
  assert.strictEqual(barcode.parsePartCode('A-B-C-D-E-F-G-XYZ1').partCode, 'XYZ1');
});

test('trims surrounding whitespace from the cell text', () => {
  assert.strictEqual(barcode.parsePartCode('  P-24-1028-010p-2.01-7604HA2K \n').partCode, '7604HA2K');
});

test('accepts a part code containing a dot', () => {
  assert.strictEqual(barcode.parsePartCode('P-24-1028-7604.2').partCode, '7604.2');
});

test('rejects rather than guessing when the shape is wrong', () => {
  const cases = [
    ['', 'blank barcode'],
    ['   ', 'blank barcode'],
    ['NODASHESHERE', 'no dash in barcode'],
    ['P-24-1028-', 'nothing after the final dash'],
    ['P-24-1028- ', 'nothing after the final dash']
  ];
  for (const [input, reason] of cases) {
    const result = barcode.parsePartCode(input);
    assert.strictEqual(result.ok, false, `expected "${input}" to be rejected`);
    assert.strictEqual(result.reason, reason);
  }
});

test('rejects a part code that could not be a filename', () => {
  // This is what stops a crafted barcode from reaching outside the folder.
  for (const input of ['P-24-../../etc/passwd', 'P-24-a\\b', 'P-24-a:b', 'P-24-a b']) {
    assert.strictEqual(barcode.parsePartCode(input).ok, false, `expected "${input}" to be rejected`);
  }
});

test('rejects non-string input', () => {
  assert.strictEqual(barcode.parsePartCode(null).ok, false);
  assert.strictEqual(barcode.parsePartCode(undefined).ok, false);
  assert.strictEqual(barcode.parsePartCode(42).ok, false);
});

test('collects part codes in grid order', () => {
  const rows = [
    { barcode: 'P-24-1028-010p-2.01-7604HA2K' },
    { barcode: 'P-24-1028-010p-2.01-8102BX9L' },
    { barcode: 'P-24-1028-011p-3.00-AB12' }
  ];
  assert.deepStrictEqual(
    barcode.collectPartCodes(rows).partCodes,
    ['7604HA2K', '8102BX9L', 'AB12']
  );
});

test('dedupes while keeping the first occurrence position', () => {
  const rows = [
    { barcode: 'P-24-1-AAA' },
    { barcode: 'P-24-2-BBB' },
    { barcode: 'P-24-3-AAA' },
    { barcode: 'P-24-4-CCC' },
    { barcode: 'P-24-5-BBB' }
  ];
  const result = barcode.collectPartCodes(rows);
  assert.deepStrictEqual(result.partCodes, ['AAA', 'BBB', 'CCC']);
  assert.strictEqual(result.duplicates, 2);
});

test('dedupes case-insensitively', () => {
  const result = barcode.collectPartCodes([{ barcode: 'P-1-ab12' }, { barcode: 'P-2-AB12' }]);
  assert.deepStrictEqual(result.partCodes, ['ab12']);
  assert.strictEqual(result.duplicates, 1);
});

test('reports unparseable rows instead of dropping them silently', () => {
  const result = barcode.collectPartCodes([
    { barcode: 'P-24-1-GOOD1' },
    { barcode: 'JUNK' },
    { barcode: '' }
  ]);
  assert.deepStrictEqual(result.partCodes, ['GOOD1']);
  assert.strictEqual(result.unparseable.length, 2);
  assert.strictEqual(result.unparseable[0].barcode, 'JUNK');
});

test('recognises barcode-shaped text for column sniffing', () => {
  assert.ok(barcode.looksLikeBarcode('P-24-1028-010p-2.01-7604HA2K'));
  assert.ok(!barcode.looksLikeBarcode('Ready'));
  assert.ok(!barcode.looksLikeBarcode('Door Left'));
  assert.ok(!barcode.looksLikeBarcode('24-1028'), 'needs at least two dashes');
  assert.ok(!barcode.looksLikeBarcode('P-24-1028 010p'), 'no whitespace allowed');
});
