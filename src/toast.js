// In-page toast, injected on demand with chrome.scripting.executeScript.
//
// Runs as a plain (non-module) content script in the tab's isolated world.
// Everything visual lives inside a closed shadow root so page CSS cannot leak
// in and ours cannot leak out. The script is idempotent: injecting it twice
// into the same tab is a no-op, and the service worker then just sends
// messages to the listener registered by the first injection.
//
// All labels arrive in the message payload (see strings.js); this file has no
// user-facing text of its own.

(() => {
  if (globalThis.__gpToastInstalled) return;
  globalThis.__gpToastInstalled = true;

  const HOST_ID = 'gp-upload-toast-host';
  const SUCCESS_DISMISS_MS = 4000;
  const cards = new Map(); // uploadId -> { card, ... }

  const CSS = `
    :host, * { box-sizing: border-box; }
    .stack {
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;      /* the stack never blocks the page… */
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
        "Helvetica Neue", Arial, sans-serif;
      font-size: 14px;
      line-height: 1.4;
      color: #202124;
    }
    .card {
      pointer-events: auto;      /* …only the cards themselves are clickable */
      width: 340px;
      max-width: calc(100vw - 40px);
      background: #ffffff;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18), 0 1px 3px rgba(0, 0, 0, 0.1);
      overflow: hidden;
      transform: translateX(120%);
      opacity: 0;
      transition: transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 200ms ease;
    }
    .card.in { transform: translateX(0); opacity: 1; }
    .card.out { transform: translateX(120%); opacity: 0; }
    .body { display: flex; align-items: center; gap: 12px; padding: 12px 12px 12px 14px; }
    .thumb {
      flex: 0 0 48px;
      width: 48px;
      height: 48px;
      border-radius: 8px;
      object-fit: cover;
      background: #e8eaed;
    }
    .thumb.hidden { display: none; }
    .text { flex: 1; min-width: 0; }
    .title { font-weight: 600; margin: 0 0 2px; }
    .detail { margin: 0; color: #5f6368; font-size: 13px; overflow-wrap: anywhere; }
    .actions { display: flex; gap: 8px; margin-top: 8px; }
    a.link, button.btn {
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      border: 0;
      background: none;
      padding: 0;
      cursor: pointer;
      color: #1a73e8;
      text-decoration: none;
    }
    a.link:hover, button.btn:hover { text-decoration: underline; }
    button.close {
      flex: 0 0 auto;
      align-self: flex-start;
      border: 0;
      background: none;
      color: #5f6368;
      font-size: 18px;
      line-height: 1;
      width: 24px;
      height: 24px;
      border-radius: 12px;
      cursor: pointer;
    }
    button.close:hover { background: rgba(0, 0, 0, 0.06); }
    .bar { height: 3px; background: #e8eaed; position: relative; overflow: hidden; }
    .bar::after {
      content: "";
      position: absolute;
      left: -40%;
      top: 0;
      height: 100%;
      width: 40%;
      background: #1a73e8;
      border-radius: 2px;
      animation: gp-slide 1.2s ease-in-out infinite;
    }
    @keyframes gp-slide {
      0%   { left: -40%; }
      100% { left: 100%; }
    }
    .card.success .bar { background: #188038; }
    .card.success .bar::after, .card.failure .bar::after { animation: none; display: none; }
    .card.success .title { color: #188038; }
    .card.failure .bar { background: #d93025; }
    .card.failure .title { color: #d93025; }
    @media (prefers-color-scheme: dark) {
      .stack { color: #e8eaed; }
      .card { background: #2d2e31; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5), 0 1px 3px rgba(0, 0, 0, 0.4); }
      .thumb { background: #3c4043; }
      .detail { color: #9aa0a6; }
      a.link, button.btn { color: #8ab4f8; }
      button.close { color: #9aa0a6; }
      button.close:hover { background: rgba(255, 255, 255, 0.08); }
      .bar { background: #3c4043; }
      .bar::after { background: #8ab4f8; }
      .card.success .title { color: #81c995; }
      .card.success .bar { background: #81c995; }
      .card.failure .title { color: #f28b82; }
      .card.failure .bar { background: #f28b82; }
    }
    @media (prefers-reduced-motion: reduce) {
      .card { transition: none; }
      .bar::after { animation: none; width: 100%; left: 0; }
    }
  `;

  let stack = null;

  function ensureStack() {
    if (stack && stack.isConnected) return stack;
    let host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = HOST_ID;
      // Keep the host itself inert; it is only a mount point for the shadow root.
      host.style.cssText = 'all: initial; display: block; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;';
      (document.body || document.documentElement).appendChild(host);
    }
    const root = host.shadowRoot || host.attachShadow({ mode: 'closed' });

    // Constructable stylesheets keep the CSS out of the page's DOM entirely
    // (so a strict page CSP cannot block it). Fall back to a <style> element
    // inside the shadow root for older builds.
    if (typeof CSSStyleSheet !== 'undefined' && 'replaceSync' in CSSStyleSheet.prototype) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      root.adoptedStyleSheets = [sheet];
    } else {
      const style = document.createElement('style');
      style.textContent = CSS;
      root.appendChild(style);
    }

    stack = document.createElement('div');
    stack.className = 'stack';
    stack.setAttribute('role', 'status');
    stack.setAttribute('aria-live', 'polite');
    root.appendChild(stack);
    return stack;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function createCard(uploadId, labels, thumbnailUrl) {
    const card = el('div', 'card');
    const body = el('div', 'body');

    const thumb = el('img', 'thumb');
    thumb.alt = labels.thumbnailAlt;
    thumb.referrerPolicy = 'no-referrer-when-downgrade';
    thumb.addEventListener('error', () => thumb.classList.add('hidden'));
    if (thumbnailUrl) thumb.src = thumbnailUrl; else thumb.classList.add('hidden');

    const text = el('div', 'text');
    const title = el('p', 'title');
    const detail = el('p', 'detail');
    const actions = el('div', 'actions');
    text.append(title, detail, actions);

    const close = el('button', 'close', '×');
    close.type = 'button';
    close.title = labels.dismiss;
    close.setAttribute('aria-label', labels.dismiss);
    close.addEventListener('click', () => dismiss(uploadId));

    body.append(thumb, text, close);
    card.append(body, el('div', 'bar'));

    ensureStack().appendChild(card);
    // Two frames so the initial transform is committed before we animate in.
    requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add('in')));

    const entry = { card, title, detail, actions, timer: null };
    cards.set(uploadId, entry);
    return entry;
  }

  function render(message) {
    const { uploadId, state, labels } = message;
    let entry = cards.get(uploadId);
    if (!entry) entry = createCard(uploadId, labels, message.thumbnail);

    const { card, title, detail, actions } = entry;
    card.classList.remove('uploading', 'success', 'failure');
    card.classList.add(state);
    actions.replaceChildren();
    if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }

    if (state === 'uploading') {
      title.textContent = labels.uploading;
      detail.textContent = '';
    } else if (state === 'success') {
      title.textContent = labels.success;
      detail.textContent = '';
      const link = el('a', 'link', labels.openLink);
      link.href = message.url || 'https://photos.google.com';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      actions.appendChild(link);
      entry.timer = setTimeout(() => dismiss(uploadId), SUCCESS_DISMISS_MS);
    } else if (state === 'failure') {
      title.textContent = labels.failedTitle;
      detail.textContent = message.reason;
      const retry = el('button', 'btn', labels.retry);
      retry.type = 'button';
      retry.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'GP_TOAST_RETRY', uploadId });
      });
      actions.appendChild(retry);
      // Failure persists until the user dismisses it.
    }
  }

  function dismiss(uploadId) {
    const entry = cards.get(uploadId);
    if (!entry) return;
    cards.delete(uploadId);
    if (entry.timer) clearTimeout(entry.timer);
    entry.card.classList.remove('in');
    entry.card.classList.add('out');
    setTimeout(() => entry.card.remove(), 300);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'GP_TOAST') render(message);
  });
})();
