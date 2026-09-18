#!/usr/bin/env node
// Derive the manifest "key" value and the Chrome extension ID from a PEM
// private key. No dependencies; uses Node's built-in crypto.
//
//   node scripts/derive-extension-id.js path/to/key.pem
//
// How Chrome does it: the extension ID is the first 16 bytes of the SHA-256
// hash of the DER-encoded SubjectPublicKeyInfo, with each nibble mapped to
// the letters a–p instead of 0–f. The manifest "key" field is that same DER
// blob, base64-encoded.

'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');

function derivePublicKeyDer(pem) {
  const privateKey = crypto.createPrivateKey(pem);
  if (privateKey.asymmetricKeyType !== 'rsa') {
    throw new Error(`Expected an RSA key, got ${privateKey.asymmetricKeyType}`);
  }
  return crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
}

function extensionIdFromDer(der) {
  const hash = crypto.createHash('sha256').update(der).digest('hex');
  // 16 bytes = 32 hex characters; a=0, b=1, ..., p=15
  return hash
    .slice(0, 32)
    .split('')
    .map((ch) => String.fromCharCode('a'.charCodeAt(0) + parseInt(ch, 16)))
    .join('');
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/derive-extension-id.js <private-key.pem>');
    process.exit(2);
  }
  const pem = fs.readFileSync(file, 'utf8');
  const der = derivePublicKeyDer(pem);
  const base64 = der.toString('base64');
  console.log('manifest "key":');
  console.log(base64);
  console.log('');
  console.log('extension ID:');
  console.log(extensionIdFromDer(der));
}

if (require.main === module) main();

module.exports = { derivePublicKeyDer, extensionIdFromDer };
