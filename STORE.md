# STORE — publishing to the Chrome Web Store, the steps only you can do

Prerequisite: SETUP.md is done and the extension works for you locally.
Work top to bottom; steps 3–4 change your extension ID and OAuth client, so
do not skip ahead. Budget: about an hour of clicking, then 1–2 weeks of
waiting on two separate Google reviews (store listing, OAuth verification).

## 1. Publish the homepage and privacy policy at photos.craigrettew.com

Google's OAuth verification requires a homepage and a privacy policy on a
domain you control. The `docs/` folder is a ready-made site, served by
GitHub Pages under your own subdomain.

1. Make the repo public: GitHub → repo → **Settings** → **Danger Zone** →
   **Change visibility** → **Make public**.
2. **Settings** → **Pages** → Source: **Deploy from a branch** → Branch:
   `main`, folder: `/docs` → **Save**.
3. In your DNS provider for craigrettew.com, add
   `CNAME  photos  →  craigfoo.github.io`.
4. **Settings** → **Pages** → **Custom domain**: `photos.craigrettew.com` →
   **Save**. Wait for "DNS check successful", then tick **Enforce HTTPS**
   (the box becomes available once the certificate is issued, usually within
   a few minutes; up to an hour if DNS is slow to propagate). `docs/CNAME`
   in the repo keeps this setting across future deploys.
5. Open https://photos.craigrettew.com/ — you should see the
   "Upload to Google Photos" page with a padlock, and
   https://photos.craigrettew.com/privacy.html the privacy policy.
6. Verify the domain in Search Console so Google accepts it as yours:
   https://search.google.com/search-console → **Add property** →
   **Domain** (the left-hand option) → enter `craigrettew.com` → **Continue**
   → copy the `google-site-verification=…` TXT record → add it at your DNS
   provider as a TXT record on the root (`@`) of craigrettew.com → back in
   Search Console click **Verify**. You should see "Ownership verified".
   (Domain verification covers every subdomain, so `photos.` is included.
   If you have verified craigrettew.com before, this step is already done.)

## 2. Register as a Chrome Web Store developer

1. Go to https://chrome.google.com/webstore/devconsole, sign in with the
   Google account that owns the Cloud project.
2. Accept the developer agreement and pay the one-time **$5** fee.
   You should land on an empty "Items" dashboard.
3. Left menu → **Account** → fill in a contact email and click **Verify**;
   confirm the email. Publishing is blocked until this shows "Verified".

## 3. Upload a first draft to get the store's extension ID

The store generates its own key pair, so the ID changes from the one in
SETUP.md. Upload once to learn the new ID, then align everything with it.

1. In a terminal in this folder:
   ```sh
   node scripts/package.js
   ```
   You should see `wrote dist/upload-to-google-photos-1.1.0.zip (11 files)`
   and `stripped "key" from manifest.json`. (If it says the client ID is still
   a placeholder, finish SETUP.md step 4 first; the value will be replaced in
   step 4 below anyway.)
2. Developer dashboard → **+ New item** → **Choose file** → pick the zip →
   **Upload**. You land on the item's editing page. Do **not** submit yet.
3. Note the **Item ID** shown in the page header (32 letters, a–p). This is
   the extension's permanent store ID.
4. Left menu → **Package** → **View public key** → select everything in the
   box, including the `-----BEGIN PUBLIC KEY-----` and `-----END PUBLIC
   KEY-----` lines, and save it as a file, e.g. `$HOME\store-key.pub`
   (Notepad is fine; make sure it saves as plain text, not `.txt` appended
   to a different name).
5. Convert it to the one-line form the manifest needs, and check the ID:
   ```powershell
   node scripts/derive-extension-id.js "$HOME\store-key.pub"
   ```
   The printed `extension ID` must equal the Item ID from step 3.3. Copy the
   single line under `manifest "key":` into your local `manifest.json` as the
   `key` value, replacing the old one. (Pasting the dashboard's multi-line
   text directly gives "Value 'key' is missing or invalid".) This makes your
   locally loaded copy use the store ID too, so one OAuth client serves both.
   Your old `.pem` from SETUP.md is no longer needed.
6. `chrome://extensions` → ↻ on the extension card → the **ID** shown must now
   equal the store Item ID from step 3.3.

## 4. Create the OAuth client for the store ID

1. https://console.cloud.google.com/auth/clients → **+ Create client** →
   type **Chrome Extension** → Name: `Upload to Google Photos (store)` →
   **Item ID**: the store Item ID from step 3.3 → **Create**.
2. Copy the new **Client ID** (ends in `.apps.googleusercontent.com`) into
   `manifest.json` → `oauth2.client_id`, replacing the old one. Save.
3. `chrome://extensions` → ↻ → right-click an image → Upload. Sign-in should
   work exactly as before; if it says `bad client id`, the Item ID on the
   client does not match step 3.3.

## 5. Finish the OAuth consent screen and submit for verification

Without this, only your test users can sign in and everyone sees the
"unverified app" screen.

1. https://console.cloud.google.com/auth/branding → fill in:
   **App logo**: upload `icons/icon128.png`.
   **App home page**: `https://photos.craigrettew.com/`.
   **Privacy policy**: `https://photos.craigrettew.com/privacy.html`.
   **Authorized domains**: `craigrettew.com`. **Save**.
2. Left menu → **Audience** → **Publish app** → **Confirm**. Status becomes
   "In production".
3. Left menu → **Verification Center** (or the "Prepare for verification"
   banner) → **Start verification**. You will be asked for:
   - **Scope justification** for `photoslibrary.appendonly`. Paste:
     > The extension adds a "Upload to Google Photos" item to Chrome's image
     > context menu. When the user chooses it, the selected image is uploaded
     > to the user's own library via `uploads` and `mediaItems:batchCreate`,
     > optionally into an album created with `albums.create`. Append-only is
     > the narrowest scope that allows this; no read access is needed or
     > requested.
   - **Demo video** (YouTube, unlisted is fine): screen-record right-click →
     Upload → the Google consent screen with the scope shown → the toast →
     the photo appearing at photos.google.com. Under two minutes.
   - Confirmation that the privacy policy URL is on the homepage domain
     (step 1.4 is what makes this pass).
4. **Submit**. Expect an email thread from `api-oauth-dev@google.com` within a
   few days; answer any follow-up in the same thread. Verified status shows in
   the Verification Center. Until then, sign-in shows the "unverified" warning
   and is capped at 100 users.

## 6. Complete the store listing and submit for review

Back in the developer dashboard, open your item. Every tab must show a green
tick before **Submit for review** is enabled.

1. **Store listing** tab:
   - **Description**: paste
     > Right-click any image in Chrome and upload it straight to your Google
     > Photos library. A small toast on the page shows a thumbnail and upload
     > progress, then links to the uploaded photo. Optionally files every
     > upload into an album you name. Uses Google's append-only scope: the
     > extension can add photos but cannot read, edit or delete anything in
     > your library. No servers, no analytics, open source.
   - **Category**: Tools (there is no Photos category; "Art & Design" is
     for editors). **Language**: English.
   - **Store icon**: upload `icons/icon128.png`.
   - **Screenshots**: upload the four files in `store/` named
     `screenshot-1…` to `screenshot-4…` (1280×800), in that order.
   - **Small promo tile**: `store/promo-small-440x280.png`.
   - **Marquee promo tile**: `store/promo-marquee-1400x560.png`.
     (Both are optional; the store shows a generic tile without them.)
   - **Official URL**: pick `craigrettew.com` (the dashboard lists the
     sites verified in Search Console under the same Google account).
   - **Support URL**: `https://github.com/craigfoo/google-photos-chrome-extension/issues`.
2. **Privacy** tab:
   - **Single purpose**: paste
     > Upload the image the user right-clicked to the user's Google Photos
     > library.
   - **Permission justifications**, one per line item:
     - `contextMenus`: Adds the single "Upload to Google Photos" item to the image context menu; this is the only way the extension is triggered.
     - `identity`: Obtains the user's Google OAuth token (append-only Photos scope) via chrome.identity so the upload can be made on the user's behalf.
     - `storage`: Saves two settings (album on/off, album name) and caches the resolved album ID.
     - `notifications`: Shows upload progress/result as a system notification only on pages where the in-page toast cannot be injected (chrome://, PDF viewer, Web Store).
     - `activeTab` and `scripting`: Injects the upload-progress toast into the tab the user right-clicked in, and, if the image host blocks direct download, reads the image through the page. Only runs after the user's context-menu click.
     - `permissions` (optional host permissions, `<all_urls>`): The extension needs to download the bytes of the image the user chose. Access is requested per image host, only at the moment of the first upload from that host, via chrome.permissions.request; nothing is accessed without that explicit grant.
     - Host permission `https://photoslibrary.googleapis.com/*`: The Google Photos Library API endpoints the image is uploaded to.
   - **Remote code**: No, I am not using remote code.
   - **Data usage**: tick **User activity**? No. Tick **Website content** →
     yes (the image the user selects). Certify the three disclosures
     (no selling, no unrelated use, no creditworthiness use).
   - **Privacy policy URL**: `https://photos.craigrettew.com/privacy.html`.
3. **Distribution** tab: Visibility **Public**, all regions, free.
4. Top-right **Submit for review**. Leave "Publish automatically after review"
   ticked. Status becomes **Pending review**. Typical wait: 1–3 days; items
   with optional `<all_urls>` sometimes get a follow-up question — answer it
   from the justifications above.

## 7. After approval

1. The item shows **Published** with a public URL like
   `https://chromewebstore.google.com/detail/<Item ID>`. Add that URL to
   `docs/index.html` and README if you like.
2. Install it from the store in a fresh Chrome profile. The ID on
   `chrome://extensions` must equal the store Item ID (it will; that is what
   step 3 was for). Sign in → upload → photo appears in Google Photos.
3. Future releases: bump `version` in `manifest.json`, run
   `node scripts/package.js`, dashboard → item → **Package** → **Upload new
   package** → **Submit for review**.

## 8. Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| Uploading the zip fails with "The manifest key field is not allowed" or similar | You zipped by hand and left `key` in | Always build with `node scripts/package.js`; it strips `key`. |
| Users report `bad client id` / sign-in fails, but it works for you unpacked | OAuth client Item ID ≠ store Item ID, or your local manifest still has the old `key` so you never noticed | Step 3.5 and 4.1: the client's Item ID must be the store's. Check `chrome://extensions` ID against the dashboard header. |
| OAuth verification rejected: "privacy policy not on homepage domain" or "domain not verified" | Step 1.6 skipped, or the policy URL points at github.com/github.io instead of your domain | Both URLs in step 5.1 must be on `photos.craigrettew.com`, and `craigrettew.com` must be a verified Domain property in Search Console. |
| https://photos.craigrettew.com shows a GitHub 404 or a certificate warning | DNS not propagated yet, or Custom domain not saved / HTTPS not enforced | `nslookup photos.craigrettew.com` should answer with `craigfoo.github.io`. Re-check Settings → Pages; wait up to an hour after adding the record. |
| Store review rejected for "excessive permissions" / "broad host permissions" | Reviewer wants the `<all_urls>` optional permission explained | Reply with the `permissions` justification from step 6.2, pointing out it is optional and requested per host at click time. |
| Store review rejected: "Missing or unclear single purpose" | Description mentions features the extension does not have | Use the description in step 6.1 verbatim. |
| Everything approved, but new users still see "Google hasn't verified this app" | OAuth verification (step 5) is separate from store review (step 6) and still pending | Check the Verification Center; reply to the `api-oauth-dev` thread if they are waiting on you. |
