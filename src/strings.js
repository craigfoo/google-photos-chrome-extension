// All user-facing text lives here so it can be reviewed and changed in one
// place. The service worker imports this as an ES module and forwards the
// toast labels to the injected toast script, which cannot import modules.

export const STRINGS = {
  // Context menu
  menuTitle: 'Upload to Google Photos',

  // Toast labels
  toast: {
    uploading: 'Uploading to Google Photos…',
    success: 'Uploaded to Google Photos',
    openLink: 'Open in Google Photos',
    failedTitle: 'Upload failed',
    retry: 'Retry',
    dismiss: 'Dismiss',
    thumbnailAlt: 'Image being uploaded',
  },

  // chrome.notifications fallback (used when the toast cannot be injected)
  notification: {
    uploadingTitle: 'Uploading to Google Photos…',
    uploadingMessage: 'Your image is on its way.',
    successTitle: 'Uploaded to Google Photos',
    successMessage: 'Open photos.google.com to see it.',
    failedTitle: 'Upload to Google Photos failed',
  },

  // Options page
  options: {
    pageTitle: 'Upload to Google Photos – Options',
    heading: 'Upload to Google Photos',
    albumCheckbox: 'Add uploads to an album',
    albumNameLabel: 'Album name',
    albumNamePlaceholder: 'e.g. From the web',
    albumHint:
      'The album is looked up by name once, then created if it does not exist. ' +
      'Change the name to switch albums.',
    saved: 'Saved',
    albumNameRequired: 'Enter an album name, or untick the box.',
  },

  // Error messages, keyed by error code. Each one is specific: the toast never
  // shows a generic "something went wrong".
  errors: {
    DATA_URL:
      'This image is an inline data: URL, not a file on a server, so there is ' +
      'nothing to upload. Save it to disk and upload it from photos.google.com.',
    BLOB_URL:
      'This image is a temporary blob: URL that only the page can read; the ' +
      'extension cannot fetch it again. Save it to disk and upload it manually.',
    CORS:
      'The image server refused a cross-origin request (CORS) and the page ' +
      'could not fetch it either. If Chrome asked to allow access to this ' +
      'site, allow it and retry; otherwise open the image in its own tab.',
    IMAGE_AUTH:
      'The image server requires a login the extension does not have ' +
      '(HTTP 401/403). Open the image directly in a tab and try from there.',
    IMAGE_HTTP: 'The image server returned HTTP {status} when fetching the image.',
    NOT_IMAGE:
      'That URL returned {type}, not an image, so it was not uploaded.',
    TOO_LARGE:
      'This image is {size} MB; Google Photos accepts at most 200 MB per upload.',
    NETWORK:
      'The connection dropped during the upload. Check your network and retry.',
    QUOTA:
      'Google Photos rejected the request because the API quota was exceeded. ' +
      'Wait a minute and retry.',
    TOKEN:
      'Your Google sign-in has expired or been revoked. Retry to sign in again.',
    AUTH_CANCELLED:
      'Sign-in was cancelled, so nothing was uploaded. Retry to sign in.',
    UPLOAD_HTTP: 'Google Photos rejected the upload with HTTP {status}: {detail}',
    CREATE_HTTP:
      'Google Photos accepted the bytes but failed to create the item ' +
      '(HTTP {status}): {detail}',
    ITEM_FAILED: 'Google Photos could not add the item: {detail}',
    ALBUM: 'Could not find or create the album "{name}": {detail}',
    EMPTY: 'The image server returned an empty file.',
  },

  // Badge text (max ~4 characters)
  badge: {
    uploading: '…',
    success: '✓',
    failure: '!',
  },
};

/**
 * Fill {placeholders} in a message template. Missing keys are left as-is so a
 * typo shows up visibly instead of silently disappearing.
 */
export function format(template, values = {}) {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    key in values ? String(values[key]) : match
  );
}
