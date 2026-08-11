const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

/**
 * Windows PowerShell 5.1 — the one built into Windows, and the one the shop
 * runs — reads a .ps1 file with no byte-order mark as ANSI (Windows-1252), not
 * UTF-8. PowerShell 7 assumes UTF-8.
 *
 * So a UTF-8 em dash (E2 80 94) in a script is read as three cp1252
 * characters, the last of which (0x94) is a curly closing quote. PowerShell
 * accepts curly quotes as string delimiters, so the string terminates early
 * and every line after it fails to parse — with errors reported far from the
 * actual character.
 *
 * Keeping the Windows-facing scripts pure ASCII sidesteps the whole encoding
 * question. This test fails loudly if a stray smart quote, em dash or accented
 * character ever gets pasted back in.
 */

const REPO = path.join(__dirname, '..');

const WINDOWS_SCRIPTS = [
  'helper/InnergyLabelHelper.ps1',
  'helper/Install-Helper.ps1',
  'helper/Install.bat',
  'helper/Test-Setup.bat',
  'helper/config.sample.json',
  'tests/helper/Run-Tests.ps1',
  'tests/helper/serve-stub.ps1'
];

function describeNonAscii(text) {
  const offenders = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    for (const char of line) {
      if (char.codePointAt(0) > 127) {
        offenders.push({
          line: index + 1,
          char,
          codePoint: 'U+' + char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'),
          text: line.trim()
        });
      }
    }
  });

  return offenders;
}

for (const relativePath of WINDOWS_SCRIPTS) {
  test(`${relativePath} is pure ASCII`, () => {
    const fullPath = path.join(REPO, relativePath);
    assert.ok(fs.existsSync(fullPath), `${relativePath} is missing`);

    const text = fs.readFileSync(fullPath, 'utf8');
    const offenders = describeNonAscii(text);

    const report = offenders
      .map((o) => `  line ${o.line}: ${o.codePoint} (${o.char}) in "${o.text}"`)
      .join('\n');

    assert.strictEqual(
      offenders.length,
      0,
      `${relativePath} contains non-ASCII characters, which Windows PowerShell 5.1 ` +
      `will misread as Windows-1252 and fail to parse:\n${report}\n` +
      `Replace them with ASCII equivalents (- for an em dash, ' for a curly quote).`
    );
  });
}

test('no Windows script carries a byte-order mark', () => {
  // A BOM would also work, but mixing BOM and no-BOM across the set is how
  // this gets confusing later. Pure ASCII needs neither.
  for (const relativePath of WINDOWS_SCRIPTS) {
    const bytes = fs.readFileSync(path.join(REPO, relativePath));
    const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    assert.strictEqual(hasBom, false, `${relativePath} unexpectedly starts with a UTF-8 BOM`);
  }
});
