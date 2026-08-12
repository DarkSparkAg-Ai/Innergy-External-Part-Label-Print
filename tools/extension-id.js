#!/usr/bin/env node
/**
 * Print the extension ID Chrome derives from the public key in manifest.json.
 *
 *     node tools/extension-id.js
 *
 * Chrome takes the SHA-256 of the public key in DER form, keeps the first 16
 * bytes, and maps each hex digit 0-f onto the letters a-p. Because the "key"
 * field pins the public key, every machine that loads this extension unpacked
 * computes the same ID - without it the ID is derived from the folder path and
 * differs per PC.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MANIFEST = path.join(__dirname, '..', 'extension', 'manifest.json');

function extensionIdFromKey(base64Key) {
  const der = Buffer.from(base64Key, 'base64');
  const digest = crypto.createHash('sha256').digest
    ? crypto.createHash('sha256').update(der).digest('hex')
    : null;

  return digest
    .slice(0, 32)
    .split('')
    .map((hex) => String.fromCharCode('a'.charCodeAt(0) + parseInt(hex, 16)))
    .join('');
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

  if (!manifest.key) {
    console.error('manifest.json has no "key" field, so the extension ID varies per machine.');
    process.exit(1);
  }

  const id = extensionIdFromKey(manifest.key);
  console.log(id);
  console.log('chrome-extension://' + id);
}

module.exports = { extensionIdFromKey, MANIFEST };

if (require.main === module) main();
