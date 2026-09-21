// Options page: one checkbox and one text field, autosaved to
// chrome.storage.sync on every change.

import { STRINGS } from './strings.js';

const enabledBox = document.getElementById('albumEnabled');
const nameInput = document.getElementById('albumName');
const field = document.getElementById('albumField');
const status = document.getElementById('status');
const disconnectButton = document.getElementById('disconnect');

function applyStrings() {
  document.title = STRINGS.options.pageTitle;
  document.getElementById('heading').textContent = STRINGS.options.heading;
  document.getElementById('albumCheckboxLabel').textContent = STRINGS.options.albumCheckbox;
  document.getElementById('albumNameLabel').textContent = STRINGS.options.albumNameLabel;
  document.getElementById('albumHint').textContent = STRINGS.options.albumHint;
  nameInput.placeholder = STRINGS.options.albumNamePlaceholder;
  document.getElementById('accountHeading').textContent = STRINGS.options.accountHeading;
  document.getElementById('accountHint').textContent = STRINGS.options.accountHint;
  disconnectButton.textContent = STRINGS.options.disconnect;
  document.getElementById('manageLink').textContent = STRINGS.options.manageLink;
}

// Drops every token Chrome has cached for this extension. It does not revoke
// the grant on Google's side (that needs the account page, linked below), but
// the service worker treats a missing token as "sign in again", which is what
// people want when switching accounts or re-testing the consent screen.
async function disconnect() {
  disconnectButton.disabled = true;
  try {
    await chrome.identity.clearAllCachedAuthTokens();
    showStatus(STRINGS.options.disconnected, false);
  } finally {
    disconnectButton.disabled = false;
  }
}

function refreshFieldState() {
  nameInput.disabled = !enabledBox.checked;
  field.classList.toggle('disabled', !enabledBox.checked);
}

let statusTimer = null;
function showStatus(text, isError) {
  status.textContent = text;
  status.classList.toggle('error', Boolean(isError));
  if (statusTimer) clearTimeout(statusTimer);
  if (!isError) statusTimer = setTimeout(() => { status.textContent = ''; }, 1500);
}

async function load() {
  const { albumEnabled, albumName } = await chrome.storage.sync.get({
    albumEnabled: false,
    albumName: '',
  });
  enabledBox.checked = albumEnabled;
  nameInput.value = albumName;
  refreshFieldState();
}

async function save() {
  const albumEnabled = enabledBox.checked;
  const albumName = nameInput.value.trim();
  await chrome.storage.sync.set({ albumEnabled, albumName });
  if (albumEnabled && !albumName) {
    showStatus(STRINGS.options.albumNameRequired, true);
  } else {
    showStatus(STRINGS.options.saved, false);
  }
}

enabledBox.addEventListener('change', () => { refreshFieldState(); save(); });
nameInput.addEventListener('input', save);
disconnectButton.addEventListener('click', disconnect);

applyStrings();
load();
