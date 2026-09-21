// Service worker: owns the context menu, auth, the upload handshake, and all
// user feedback (in-page toast, notification fallback, toolbar badge).

import { STRINGS, format } from './strings.js';

const MENU_ID = 'upload-to-google-photos';
const PHOTOS_API = 'https://photoslibrary.googleapis.com/v1';
const PHOTOS_HOME = 'https://photos.google.com';
const MAX_BYTES = 200 * 1024 * 1024; // Google Photos hard limit per upload
const BADGE_CLEAR_MS = 4000;

// Uploads in flight or finished, keyed by an id shared with the toast so a
// Retry click can be mapped back to the original request.
const uploads = new Map();
let nextUploadId = 1;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** An error with a code that maps to a specific message in strings.js. */
class UploadError extends Error {
  constructor(code, values = {}) {
    super(format(STRINGS.errors[code] || code, values));
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Install / menu
// ---------------------------------------------------------------------------

// removeAll first so a reload (which also fires onInstalled) does not fail
// with "duplicate id". Also rebuilt on browser startup as a safety net.
function createMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: STRINGS.menuTitle,
      contexts: ['image'],
    });
  });
}

chrome.runtime.onInstalled.addListener(createMenu);
chrome.runtime.onStartup.addListener(createMenu);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.srcUrl) return;
  // Must be called synchronously here: the permission prompt needs the user
  // gesture from the menu click, and any await before it would consume it.
  const hostAccess = requestHostAccess(info.srcUrl);
  startUpload({ srcUrl: info.srcUrl, tabId: tab && tab.id, pageUrl: info.pageUrl, hostAccess });
});

// Retry button in the toast sends this back to us.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message && message.type === 'GP_TOAST_RETRY') {
    const previous = uploads.get(message.uploadId);
    if (previous) {
      startUpload({
        srcUrl: previous.srcUrl,
        tabId: sender.tab ? sender.tab.id : previous.tabId,
        pageUrl: previous.pageUrl,
        reuseId: message.uploadId,
        // No user gesture on a retry, so only check what was granted before.
        hostAccess: hasHostAccess(previous.srcUrl),
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Optional host permission for the image's origin
// ---------------------------------------------------------------------------

/**
 * Host permissions are optional (<all_urls> under optional_host_permissions)
 * so the store listing does not carry a blanket "read all sites" warning.
 * Instead we ask for the image's origin the first time it is used; Chrome
 * shows one prompt per origin and remembers the answer. Once granted, the
 * worker's fetch to that host is no longer subject to CORS.
 */
function originPatternFor(srcUrl) {
  try {
    const url = new URL(srcUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return `${url.origin}/*`;
  } catch (err) {
    return null;
  }
}

function requestHostAccess(srcUrl) {
  const pattern = originPatternFor(srcUrl);
  if (!pattern) return Promise.resolve(false);
  try {
    return chrome.permissions.request({ origins: [pattern] }).catch(() => false);
  } catch (err) {
    // No user gesture available (should not happen from a menu click).
    return Promise.resolve(false);
  }
}

function hasHostAccess(srcUrl) {
  const pattern = originPatternFor(srcUrl);
  if (!pattern) return Promise.resolve(false);
  return chrome.permissions.contains({ origins: [pattern] }).catch(() => false);
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function startUpload({ srcUrl, tabId, pageUrl, reuseId, hostAccess }) {
  const uploadId = reuseId || `gp-${Date.now()}-${nextUploadId++}`;
  uploads.set(uploadId, { srcUrl, tabId, pageUrl });

  const feedback = await createFeedback(uploadId, tabId, srcUrl);
  await feedback.uploading();
  setBadge('uploading');

  try {
    // Wait for the permission prompt (if any) before touching the network.
    await hostAccess;
    const result = await uploadImage(srcUrl, tabId);
    setBadge('success');
    await feedback.success(result.productUrl || PHOTOS_HOME);
  } catch (err) {
    console.error('[Upload to Google Photos] failed:', err);
    setBadge('failure');
    const reason = err instanceof UploadError ? err.message : String(err && err.message || err);
    await feedback.failure(reason);
  }
}

/**
 * The whole pipeline: fetch bytes -> auth -> upload bytes -> (album) ->
 * batchCreate. Returns the created media item.
 */
async function uploadImage(srcUrl, tabId) {
  const { bytes, mime, fileName } = await fetchImage(srcUrl, tabId);

  // Step 1 of the handshake: send raw bytes, get back an upload token. The
  // token is just a string that identifies the bytes on Google's side; it is
  // not yet a media item and expires after about a day.
  const uploadToken = await withAuthRetry((token) => uploadBytes(token, bytes, mime));

  // Optional album. Resolved after the upload so a bad album name does not
  // waste the bytes transfer... and after auth so we reuse the same token.
  const albumId = await withAuthRetry((token) => resolveAlbumId(token));

  // Step 2 of the handshake: turn the upload token into a media item.
  return withAuthRetry((token) => createMediaItem(token, uploadToken, fileName, albumId));
}

// ---------------------------------------------------------------------------
// Fetching the image
// ---------------------------------------------------------------------------

/**
 * Get the image bytes. Tries the service worker first (not subject to CORS
 * once the image's origin has been granted, see requestHostAccess), then
 * falls back to fetching inside the page, which uses the page's origin and
 * cookies and therefore works for same-site images and images behind a login
 * the page already has.
 */
async function fetchImage(srcUrl, tabId) {
  if (srcUrl.startsWith('data:')) throw new UploadError('DATA_URL');
  if (srcUrl.startsWith('blob:')) throw new UploadError('BLOB_URL');

  let response;
  try {
    // With the origin granted, Chrome also sends the user's cookies for the
    // image host, so images behind a cookie login usually work here too.
    response = await fetch(srcUrl, { credentials: 'include' });
  } catch (workerErr) {
    // A TypeError here is almost always CORS (origin not granted, or the
    // user declined the prompt) or the host being unreachable. The page
    // itself may still be allowed to read the image, so ask it.
    const fromPage = tabId != null ? await fetchImageInPage(tabId, srcUrl) : null;
    if (!fromPage) throw new UploadError('CORS');
    return finishFetch(fromPage.bytes, fromPage.contentType, srcUrl);
  }

  if (response.status === 401 || response.status === 403) {
    // The worker has no session for this host. The page might.
    const fromPage = tabId != null ? await fetchImageInPage(tabId, srcUrl) : null;
    if (!fromPage) throw new UploadError('IMAGE_AUTH');
    return finishFetch(fromPage.bytes, fromPage.contentType, srcUrl);
  }
  if (!response.ok) throw new UploadError('IMAGE_HTTP', { status: response.status });

  // Refuse early if the server tells us the size up front.
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_BYTES) {
    throw new UploadError('TOO_LARGE', { size: toMb(declared) });
  }

  let buffer;
  try {
    buffer = await response.arrayBuffer();
  } catch (err) {
    throw new UploadError('NETWORK');
  }
  return finishFetch(buffer, response.headers.get('content-type'), srcUrl);
}

/** Runs inside the tab: fetch the URL with the page's credentials and return base64. */
function pageFetchImage(url) {
  return fetch(url, { credentials: 'include' })
    .then((res) => {
      if (!res.ok) return null;
      return res.arrayBuffer().then((buf) => {
        // Chunked to avoid call-stack limits on large images.
        const view = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < view.length; i += 0x8000) {
          binary += String.fromCharCode.apply(null, view.subarray(i, i + 0x8000));
        }
        return { base64: btoa(binary), contentType: res.headers.get('content-type') };
      });
    })
    .catch(() => null);
}

async function fetchImageInPage(tabId, srcUrl) {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: pageFetchImage,
      args: [srcUrl],
    });
    if (!injection || !injection.result) return null;
    const binary = atob(injection.result.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { bytes: bytes.buffer, contentType: injection.result.contentType };
  } catch (err) {
    // Injection not possible on this tab (chrome://, PDF viewer, Web Store...).
    return null;
  }
}

/** Shared tail of both fetch paths: validate size and type, pick a file name. */
function finishFetch(buffer, contentType, srcUrl) {
  if (!buffer || buffer.byteLength === 0) throw new UploadError('EMPTY');
  if (buffer.byteLength > MAX_BYTES) {
    throw new UploadError('TOO_LARGE', { size: toMb(buffer.byteLength) });
  }
  const mime = resolveMime(contentType, srcUrl);
  return { bytes: buffer, mime, fileName: fileNameFor(srcUrl, mime) };
}

const EXTENSION_MIMES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', heic: 'image/heic', heif: 'image/heif',
  avif: 'image/avif', tif: 'image/tiff', tiff: 'image/tiff', svg: 'image/svg+xml',
};

/**
 * Mime resolution order: response Content-Type, then URL extension, then
 * image/jpeg. A Content-Type that is clearly not an image (HTML, JSON, video)
 * is an error rather than a fallback, because uploading it would just fail
 * later with a less useful message.
 */
function resolveMime(contentType, srcUrl) {
  const header = (contentType || '').split(';')[0].trim().toLowerCase();
  if (header.startsWith('image/')) return header;

  const generic = header === '' || header === 'application/octet-stream' || header === 'binary/octet-stream';
  if (!generic) throw new UploadError('NOT_IMAGE', { type: header });

  const ext = extensionOf(srcUrl);
  return EXTENSION_MIMES[ext] || 'image/jpeg';
}

function extensionOf(url) {
  try {
    const path = new URL(url).pathname;
    const match = /\.([a-z0-9]+)$/i.exec(path);
    return match ? match[1].toLowerCase() : '';
  } catch (err) {
    return '';
  }
}

function fileNameFor(url, mime) {
  let base = '';
  try {
    base = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
  } catch (err) {
    // ignore
  }
  base = base.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'image';
  if (!/\.[a-z0-9]{2,5}$/i.test(base)) {
    const ext = Object.keys(EXTENSION_MIMES).find((k) => EXTENSION_MIMES[k] === mime) || 'jpg';
    base += `.${ext}`;
  }
  return base;
}

function toMb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** Promise wrapper around chrome.identity.getAuthToken with clear errors. */
function getAuthToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (result) => {
      const token = typeof result === 'string' ? result : result && result.token;
      if (chrome.runtime.lastError || !token) {
        const msg = (chrome.runtime.lastError && chrome.runtime.lastError.message) || '';
        // Chrome reports a closed consent window as "The user did not approve access."
        const cancelled = /did not approve|canceled|cancelled|closed/i.test(msg);
        reject(new UploadError(cancelled ? 'AUTH_CANCELLED' : 'TOKEN'));
        return;
      }
      resolve(token);
    });
  });
}

function removeCachedAuthToken(token) {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
  });
}

/**
 * Token refresh path. Chrome caches OAuth tokens and happily hands back one
 * that Google has since expired or the user has revoked. The only way to find
 * out is to use it: on a 401 we drop the cached token, ask Chrome for a fresh
 * one (silently if possible, otherwise with the consent UI) and retry exactly
 * once. A second 401 means the grant itself is gone, so we report that.
 */
async function withAuthRetry(operation) {
  let token = await getAuthToken(true);
  try {
    return await operation(token);
  } catch (err) {
    if (!(err instanceof HttpError) || err.status !== 401) throw err;
    await removeCachedAuthToken(token);
    try {
      token = await getAuthToken(false);
    } catch (silentErr) {
      token = await getAuthToken(true);
    }
    try {
      return await operation(token);
    } catch (retryErr) {
      if (retryErr instanceof HttpError && retryErr.status === 401) {
        await removeCachedAuthToken(token);
        throw new UploadError('TOKEN');
      }
      throw retryErr;
    }
  }
}

// ---------------------------------------------------------------------------
// Google Photos API
// ---------------------------------------------------------------------------

class HttpError extends Error {
  constructor(status, detail) {
    super(`HTTP ${status}: ${detail}`);
    this.status = status;
    this.detail = detail;
  }
}

/** Fetch wrapper that turns network failures and non-2xx into typed errors. */
async function apiFetch(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (err) {
    throw new UploadError('NETWORK');
  }
  if (response.ok) return response;

  const detail = await extractErrorDetail(response);
  if (response.status === 401) throw new HttpError(401, detail);
  if (response.status === 429 || /quota|rate ?limit/i.test(detail)) {
    throw new UploadError('QUOTA');
  }
  throw new HttpError(response.status, detail);
}

async function extractErrorDetail(response) {
  const text = await response.text().catch(() => '');
  try {
    const json = JSON.parse(text);
    return (json.error && (json.error.message || json.error.status)) || text;
  } catch (err) {
    return text.slice(0, 300) || response.statusText || 'no details';
  }
}

/**
 * Handshake step 1: POST the raw bytes to the uploads endpoint. The body is
 * the file itself, not multipart. The three X-Goog-Upload-* headers tell the
 * endpoint that this is a single-shot "raw" upload (as opposed to resumable)
 * and what the bytes are. The response body is the upload token as plain text.
 */
async function uploadBytes(token, bytes, mime) {
  try {
    const response = await apiFetch(`${PHOTOS_API}/uploads`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'X-Goog-Upload-Content-Type': mime,
        'X-Goog-Upload-Protocol': 'raw',
      },
      body: bytes,
    });
    const uploadToken = (await response.text()).trim();
    if (!uploadToken) throw new UploadError('UPLOAD_HTTP', { status: 200, detail: 'empty upload token' });
    return uploadToken;
  } catch (err) {
    if (err instanceof HttpError && err.status !== 401) {
      throw new UploadError('UPLOAD_HTTP', { status: err.status, detail: err.detail });
    }
    throw err;
  }
}

/**
 * Handshake step 2: exchange the upload token for a real media item. Google
 * Photos only returns 200 here; per-item failures are reported inside
 * newMediaItemResults[i].status, so we have to inspect that too.
 */
async function createMediaItem(token, uploadToken, fileName, albumId) {
  const body = {
    newMediaItems: [
      {
        description: '',
        simpleMediaItem: { fileName, uploadToken },
      },
    ],
  };
  if (albumId) body.albumId = albumId;

  let response;
  try {
    response = await apiFetch(`${PHOTOS_API}/mediaItems:batchCreate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (err instanceof HttpError && err.status !== 401) {
      throw new UploadError('CREATE_HTTP', { status: err.status, detail: err.detail });
    }
    throw err;
  }

  const json = await response.json();
  const result = json.newMediaItemResults && json.newMediaItemResults[0];
  if (!result) throw new UploadError('ITEM_FAILED', { detail: 'empty response' });
  const status = result.status || {};
  // status.code 0 (or absent) means OK; "message" is "Success" in that case.
  if (status.code && status.code !== 0) {
    throw new UploadError('ITEM_FAILED', { detail: status.message || `code ${status.code}` });
  }
  return result.mediaItem || {};
}

// ---------------------------------------------------------------------------
// Albums
// ---------------------------------------------------------------------------

/**
 * Returns an albumId if the user enabled the album option, else null.
 * Lookup order: chrome.storage.local cache -> albums.list (all pages) ->
 * albums.create. The cache is keyed by album name so renaming in the options
 * page naturally switches albums.
 */
async function resolveAlbumId(token) {
  const { albumEnabled, albumName } = await chrome.storage.sync.get({
    albumEnabled: false,
    albumName: '',
  });
  const name = (albumName || '').trim();
  if (!albumEnabled || !name) return null;

  const { albumCache = {} } = await chrome.storage.local.get({ albumCache: {} });
  if (albumCache[name]) return albumCache[name];

  try {
    let albumId = await findAlbumByTitle(token, name);
    if (!albumId) albumId = await createAlbum(token, name);
    albumCache[name] = albumId;
    await chrome.storage.local.set({ albumCache });
    return albumId;
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) throw err; // let withAuthRetry handle it
    if (err instanceof UploadError && err.code !== 'ALBUM') throw err;
    throw new UploadError('ALBUM', { name, detail: err.detail || err.message });
  }
}

async function findAlbumByTitle(token, title) {
  let pageToken = '';
  do {
    const url = new URL(`${PHOTOS_API}/albums`);
    url.searchParams.set('pageSize', '50');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    let response;
    try {
      response = await apiFetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    } catch (err) {
      // The appendonly scope is allowed to create albums but Google may deny
      // listing them (403). In that case we simply create a new one.
      if (err instanceof HttpError && err.status === 403) return null;
      throw err;
    }
    const json = await response.json();
    const match = (json.albums || []).find((album) => album.title === title);
    if (match) return match.id;
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return null;
}

async function createAlbum(token, title) {
  const response = await apiFetch(`${PHOTOS_API}/albums`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ album: { title } }),
  });
  const json = await response.json();
  if (!json.id) throw new HttpError(200, 'album created without an id');
  return json.id;
}

// ---------------------------------------------------------------------------
// Feedback: toast (preferred) with notification fallback
// ---------------------------------------------------------------------------

/**
 * Returns an object with uploading()/success(url)/failure(reason). The toast
 * is injected once per tab; later calls just message it. If injection fails
 * (chrome://, the PDF viewer, the Web Store, file:// without access...) we
 * fall back to chrome.notifications for the whole lifetime of this upload.
 */
async function createFeedback(uploadId, tabId, srcUrl) {
  const toastReady = tabId != null && (await injectToast(tabId));
  if (toastReady) {
    const send = (payload) =>
      chrome.tabs
        .sendMessage(tabId, { type: 'GP_TOAST', uploadId, labels: STRINGS.toast, ...payload })
        .catch(() => {}); // tab navigated away; nothing to show
    return {
      uploading: () => send({ state: 'uploading', thumbnail: srcUrl }),
      success: (url) => send({ state: 'success', url }),
      failure: (reason) => send({ state: 'failure', reason }),
    };
  }
  return notificationFeedback(uploadId);
}

async function injectToast(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/toast.js'] });
    return true;
  } catch (err) {
    return false;
  }
}

function notificationFeedback(uploadId) {
  const notificationId = `gp-${uploadId}`;
  const show = (title, message) =>
    new Promise((resolve) => {
      chrome.notifications.create(
        notificationId,
        {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon128.png'),
          title,
          message,
          priority: 1,
        },
        () => resolve()
      );
    });
  return {
    uploading: () => show(STRINGS.notification.uploadingTitle, STRINGS.notification.uploadingMessage),
    success: () => show(STRINGS.notification.successTitle, STRINGS.notification.successMessage),
    failure: (reason) => show(STRINGS.notification.failedTitle, reason),
  };
}

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith('gp-')) {
    chrome.tabs.create({ url: PHOTOS_HOME });
    chrome.notifications.clear(notificationId);
  }
});

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

let badgeTimer = null;

function setBadge(state) {
  const colors = { uploading: '#1a73e8', success: '#188038', failure: '#d93025' };
  chrome.action.setBadgeBackgroundColor({ color: colors[state] });
  chrome.action.setBadgeText({ text: STRINGS.badge[state] });
  if (badgeTimer) clearTimeout(badgeTimer);
  badgeTimer = null;
  if (state !== 'uploading') {
    badgeTimer = setTimeout(() => chrome.action.setBadgeText({ text: '' }), BADGE_CLEAR_MS);
  }
}
