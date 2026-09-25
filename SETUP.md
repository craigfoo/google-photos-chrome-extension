# SETUP — the steps only you can do

Work top to bottom. Every step says what to click or type and what you should
see when it worked.

## 1. Generate your key pair and derive the extension ID

1. In a terminal, in this folder, type:

   macOS / Linux:
   ```sh
   openssl genrsa -out ~/google-photos-ext.pem 2048
   node scripts/derive-extension-id.js ~/google-photos-ext.pem
   ```
   Windows PowerShell (`~` is not expanded for `openssl.exe`, so use `$HOME`):
   ```powershell
   openssl genrsa -out "$HOME\google-photos-ext.pem" 2048
   node scripts/derive-extension-id.js "$HOME\google-photos-ext.pem"
   ```
   You should see two things printed: a long base64 string under
   `manifest "key":` and a 32-letter ID (letters a–p only) under `extension ID:`.
2. Open `manifest.json` and replace `YOUR_PUBLIC_KEY_HERE` with the base64
   string (keep the quotes). Save.
3. Write down the 32-letter ID; steps 4 and 5 need it.
4. Keep `google-photos-ext.pem` (in your home folder) somewhere safe and **out of this repo**. If
   you lose it you can regenerate, but the extension ID and OAuth client will
   change and you will redo steps 1–4.

## 2. Create a Google Cloud project and enable the Photos Library API

1. Go to https://console.cloud.google.com/projectcreate, name the project
   (e.g. `photos-uploader`), click **Create**. You should see a notification
   "Creating project…" then the project selected in the top bar.
2. Go to https://console.cloud.google.com/apis/library/photoslibrary.googleapis.com
   (make sure the new project is selected in the top bar) and click **Enable**.
   You should land on the API's overview page with a **Manage** button
   instead of **Enable**.

## 3. Configure the OAuth consent screen (External, Testing)

1. Go to https://console.cloud.google.com/auth/overview and click
   **Get started** (or **Configure** if it shows an existing config).
2. App name: `Upload to Google Photos`. User support email: your address.
   Audience: **External**. Contact email: your address. Agree and **Create**.
   You should see the "OAuth Overview" page for your app.
3. Left menu → **Audience** → under **Test users** click **+ Add users**, type
   your own Google account email, **Save**. Your email should now be listed.
4. Left menu → **Data Access** → **Add or remove scopes**. In the filter box
   type `photoslibrary.appendonly`, tick
   `https://www.googleapis.com/auth/photoslibrary.appendonly`, **Update**, then
   **Save**. The scope should appear under "Your sensitive scopes".

**About Testing mode:** while the app's publishing status is *Testing*, the
refresh token Google issues expires after **7 days**. Every week you will see
the Google consent screen again on the next upload — just approve it. If that
annoys you: **Audience → Publish app → Confirm**. You do *not* have to submit
for verification; an unverified app in Production keeps working with no
7-day limit, at the cost of a "Google hasn't verified this app" warning on
the first sign-in (click **Advanced → Go to Upload to Google Photos
(unsafe)** once). Because it only ever uses the `appendonly` scope with your
own account, that is fine for personal use.

## 4. Create the OAuth client (type: Chrome Extension)

1. Go to https://console.cloud.google.com/auth/clients and click
   **+ Create client**.
2. Application type: **Chrome Extension**. Name: anything.
   **Item ID**: paste the 32-letter extension ID from step 1. Click **Create**.
3. A dialog shows **Client ID** ending in `.apps.googleusercontent.com`. Copy
   it.
4. Open `manifest.json` and replace `YOUR_CLIENT_ID_HERE` with that client ID
   (keep the quotes). Save.

## 5. Load the unpacked extension

1. In Chrome open `chrome://extensions`. Toggle **Developer mode** (top-right)
   on. You should see three new buttons: Load unpacked / Pack extension /
   Update.
2. Click **Load unpacked**, pick this folder (the one containing
   `manifest.json`), **Select**.
3. A card "Upload to Google Photos 1.1.0" appears. Under it, **ID:** must be
   exactly the 32-letter ID from step 1. If it is different, the `key` in
   `manifest.json` was pasted wrong — fix it and click the ↻ reload icon on
   the card.
4. Optional: click the puzzle-piece icon in the toolbar and pin
   "Upload to Google Photos" so you can see the badge.

## 6. First-run smoke test

1. Open any normal web page with a photo on it (for example a Wikipedia
   article).
2. Right-click the photo. The context menu should contain
   **Upload to Google Photos**. Click it.
3. Expected on the first run: a Google sign-in window opens. Pick the account
   you added as a test user, and approve
   "Add to your Google Photos library". (In Testing mode you'll be told the
   app is unverified; continue.)
4. Expected next: a small Chrome prompt "Upload to Google Photos wants
   additional permissions — Read and change your data on <image host>".
   Click **Allow**; it is asked once per image host and is what lets the
   extension download the image bytes. Then a toast slides in at the
   bottom-right of the page with a thumbnail and a moving blue bar, then
   turns green:
   **Uploaded to Google Photos** with an **Open in Google Photos** link. The
   toolbar badge shows `…` then a green `✓`. The toast disappears after 4 s.
5. Open https://photos.google.com — the image should be at the top of your
   library (and in the album if you turned that on in the extension's
   options: right-click the extension icon → **Options**).

## 7. Troubleshooting

Open the service worker console first: `chrome://extensions` → the extension's
card → click **service worker** (blue link). Errors are logged there with the
prefix `[Upload to Google Photos]`.

| Symptom | Likely cause | What to check / do |
| --- | --- | --- |
| Red toast: "Your Google sign-in has expired or been revoked", or console shows `OAuth2 request failed: ... bad client id` / `invalid_client` | `oauth2.client_id` wrong, or the OAuth client's Item ID does not match the extension ID Chrome shows | `chrome://extensions` ID must equal the Item ID in the Cloud Console client. Re-check `key` in `manifest.json` (step 1) and the client ID (step 4). Reload the extension after edits. |
| Sign-in window says "Access blocked: … has not completed the Google verification process" / "Error 403: access_denied" | Your account is not a test user, or you signed in with a different account | Step 3.3: add the exact email you are signing in with under **Test users**. |
| Console: `403 ... Photos Library API has not been used in project ... or it is disabled` | API not enabled in the project that owns the OAuth client | Step 2.2 — enable the API in the same project as the client, wait a minute, retry. |
| Red toast "The image server refused a cross-origin request (CORS)…" | You dismissed or declined the "Allow access to <image host>?" prompt Chrome showed after the menu click, so the extension had to fall back to reading through the page, which that host also blocks | Right-click the image → Upload again and click **Allow** on the prompt (Chrome remembers it per host). If no prompt appears, check `chrome://extensions` → Details → "Site access" for that host. Last resort: open the image in its own tab and upload from there. |
| Consent screen pops up again after ~7 days | Publishing status is Testing | Expected. Approve again, or publish to Production (see note in step 3). |
| Every upload asks you to sign in to Google, you do, and the next upload asks again | Chrome itself is not signed in on that computer. The extension can only get a token for the account Chrome is signed in to; signing in on a web page or in the popup does not always sign Chrome in | Click your profile picture at the top right of Chrome → **Sign in** (or **Turn on sync**) with the Google account you use for Photos. If there's no sign-in option: Settings → You and Google → turn on **Allow Chrome sign-in**. Then retry. The red toast quotes Chrome's exact error. |
| No toast at all, only a system notification | The page cannot be scripted (chrome://, PDF viewer, Chrome Web Store, file:// URL) | That is the built-in fallback. For `file://` pages, enable **Allow access to file URLs** on the extension card. |
| "Upload to Google Photos" is missing from the menu on Instagram / Facebook / Threads (no "Save image as…" either) | The site covers its photos with an invisible layer, so Chrome shows the page menu, not the image menu | Use the other item, **Upload image under cursor to Google Photos**, which appears in the page menu on those sites. Right-click on the photo itself and do not move the mouse before clicking the item. |
