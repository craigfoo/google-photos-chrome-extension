// Options page: one checkbox and one text field, autosaved to
// chrome.storage.sync on every change.

import { STRINGS } from './strings.js';

const enabledBox = document.getElementById('albumEnabled');
const nameInput = document.getElementById('albumName');
const field = document.getElementById('albumField');
const status = document.getElementById('status');

function applyStrings() {
  document.title = STRINGS.options.pageTitle;
  document.getElementById('heading').textContent = STRINGS.options.heading;
  document.getElementById('albumCheckboxLabel').textContent = STRINGS.options.albumCheckbox;
  document.getElementById('albumNameLabel').textContent = STRINGS.options.albumNameLabel;
  document.getElementById('albumHint').textContent = STRINGS.options.albumHint;
  nameInput.placeholder = STRINGS.options.albumNamePlaceholder;
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

applyStrings();
load();
