const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { extensionIdFromKey } = require('../tools/extension-id.js');

const REPO = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'extension', 'manifest.json'), 'utf8'));

// The ID Chrome derives from the manifest's public key. Written out here so
// that swapping the key without updating the documentation fails the build -
// the helper's allowedOrigins and the README both quote this string.
const EXPECTED_ID = 'bhlcomepjijkhfmnhbocbdmifoaifmge';

test('the manifest pins a public key', () => {
  assert.ok(manifest.key, 'no "key" field: the extension ID would differ on every machine');
});

test('the key is a valid DER public key', () => {
  const der = Buffer.from(manifest.key, 'base64');
  // Re-encoding must round-trip, or the value is not clean base64.
  assert.strictEqual(der.toString('base64'), manifest.key);
  assert.ok(der.length > 100, 'suspiciously short for an RSA public key');
  assert.strictEqual(der[0], 0x30, 'DER SEQUENCE expected');
});

test('the extension ID is stable and matches the documentation', () => {
  assert.strictEqual(extensionIdFromKey(manifest.key), EXPECTED_ID);
});

test('the ID is 32 letters in a-p', () => {
  const id = extensionIdFromKey(manifest.key);
  assert.strictEqual(id.length, 32);
  assert.match(id, /^[a-p]{32}$/);
});

test('the README quotes the same extension ID', () => {
  const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
  assert.ok(
    readme.includes(EXPECTED_ID),
    'README should quote the extension ID so the helper can be locked to it'
  );
});

test('no private key is committed', () => {
  // The .pem belongs in a password manager, never in the repo.
  const offenders = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(pem|key|p12|pfx)$/i.test(entry.name)) offenders.push(full);
    }
  }
  walk(REPO);

  assert.deepStrictEqual(offenders, [], 'private key material found in the repo');
});

test('the manifest still declares only the permissions we justify', () => {
  // Adding a permission changes what a Web Store review asks about, and what
  // Chrome warns users at install time. Keep it deliberate.
  assert.deepStrictEqual([...manifest.permissions].sort(), ['storage', 'tabs']);
  assert.deepStrictEqual([...manifest.host_permissions].sort(), [
    'http://127.0.0.1/*',
    'http://localhost/*',
    'https://app.innergy.com/*'
  ]);
});
