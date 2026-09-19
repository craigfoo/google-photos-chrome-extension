#!/usr/bin/env node
// Derive the manifest "key" value and the Chrome extension ID from a PEM
// key. No dependencies; uses Node's built-in crypto.
//
//   node scripts/derive-extension-id.js path/to/key.pem
//
// The file may be either:
//   - an RSA private key you generated (SETUP.md step 1), or
//   - the public key the Chrome Web Store shows under Package -> "View
//     public key" (STORE.md step 3), pasted into a file as-is, BEGIN/END
//     lines included. The script prints the one-line value the manifest
//     needs and the extension ID, which must match the store's Item ID.
//
// How Chrome does it: the extension ID is the first 16 bytes of the SHA-256
// hash of the DER-encoded SubjectPublicKeyInfo, with each nibble mapped to
// the letters a–p instead of 0–f. The manifest "key" field is that same DER
// blob, base64-encoded.

'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');

/**
 * Read the key file as text whatever editor wrote it: strips a UTF-8 BOM and
 * decodes UTF-16 (which PowerShell's `>` redirection produces on Windows).
 */
function readKeyText(file) {
  const buf = fs.readFileSync(file);
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2);
  if (buf[0] === 0xfe && buf[1] === 0xff) return buf.swap16().toString('utf16le', 2);
  if (buf.length > 1 && buf[1] === 0x00) return buf.toString('utf16le');
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.toString('utf8', 3);
  return buf.toString('utf8');
}

/**
 * Accepts any of: an RSA private key PEM, a public key PEM (BEGIN/END lines
 * included), or the bare base64 body of a public key as the dashboard or a
 * manifest "key" field shows it.
 */
function derivePublicKeyDer(text) {
  const trimmed = text.trim();
  let publicKey;
  if (/-----BEGIN (RSA )?PUBLIC KEY-----/.test(trimmed)) {
    publicKey = crypto.createPublicKey(trimmed);
  } else if (/-----BEGIN .*PRIVATE KEY-----/.test(trimmed)) {
    publicKey = crypto.createPublicKey(crypto.createPrivateKey(trimmed));
  } else if (/^MII[A-Za-z0-9+/=\s]+$/.test(trimmed)) {
    // "MII" is how every base64 DER SubjectPublicKeyInfo of this size starts.
    const der = Buffer.from(trimmed.replace(/\s+/g, ''), 'base64');
    publicKey = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
  } else {
    throw new Error(
      'Unrecognised key file. Expected a PEM private key, a "-----BEGIN PUBLIC KEY-----" block, ' +
      'or a bare base64 public key. First line seen: ' + JSON.stringify(trimmed.split('\n')[0].slice(0, 60))
    );
  }
  if (publicKey.asymmetricKeyType !== 'rsa') {
    throw new Error(`Expected an RSA key, got ${publicKey.asymmetricKeyType}`);
  }
  return publicKey.export({ type: 'spki', format: 'der' });
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
    console.error('Usage: node scripts/derive-extension-id.js <key file (private PEM, public PEM, or base64)>');
    process.exit(2);
  }
  const der = derivePublicKeyDer(readKeyText(file));
  const base64 = der.toString('base64');
  console.log('manifest "key":');
  console.log(base64);
  console.log('');
  console.log('extension ID:');
  console.log(extensionIdFromDer(der));
}

if (require.main === module) main();

module.exports = { derivePublicKeyDer, extensionIdFromDer };
