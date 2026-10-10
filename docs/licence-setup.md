# Licence keys: setting up the sheet and key server

TenderAssist runs only with a key. A key belongs to **one Google account** and a
set number of **PCs** (price per PC). It has a last day, then **grace days** with
a warning in the app, then the app **locks**.

The owner manages keys in a Google Sheet ("the licence sheet"). The same sheet's
Apps Script is the key server the app and installer call.

```
Owner ── edits ──► Licence sheet (Keys · PCs · Log · Settings)
                        │ Apps Script web app (signs every answer)
Installer ── "is this key real?" ──┤
App ── activate (key + Google sign-in) / check every 6 h ──┘
```

## What the customer sees

1. **Installer**: after the Terms and the install folder, a page asks for the key.
   An unknown or ended key is refused there. Without internet, setup continues
   and the app checks on first start.
2. **First start**: the key is filled in. The customer presses **Continue with
   Google** and signs in. The key is now linked to that Google account and this
   PC.
3. **Every start and every 6 hours**: the app checks the key. Changes in the
   sheet (a new end date, Suspended, Reset PCs) take effect then.
4. **Last 3 days, then grace days**: a strip at the bottom of the app shows
   "Your trial ends in 2 days…", then "Your key ended on … locks on …".
5. **Locked**: the whole window shows "Your key has ended", with **Check again**
   (after you renew), **Use a different key**, and your contact line.
6. **Offline**: the app works for 3 days after its last good check, never past
   the key's grace end. A PC clock turned back a day or more is noticed.

## One-time setup, automatic (recommended)

1. Switch on **Google Apps Script API** at https://script.google.com/home/usersettings.
2. Sign in once: `npx @google/clasp@2.4.2 login`, with the company Google account.
3. Run `node licence-server/deploy.cjs`. It makes the **TenderAssist Licences**
   sheet with the script bound to it, uploads the private key (as `Secret.gs`,
   kept out of git), publishes the web app, and writes its URL into
   `src/licence/licenceServer.ts` and `build/installer.nsh`. It prints the sheet
   link.
4. Open the sheet, then **Licences → Set up / repair this sheet…**, and **Allow**.
   Google needs the owner to approve once. Paste the Google client ID when
   asked (see step 3 under the manual setup below).
5. Fill **Contact shown to customers** on the Settings tab.

To change the script later, edit `licence-server/Code.gs` and run
`node licence-server/deploy.cjs` again. It publishes a new version on the
**same** URL. Its working files (and the deployment id) are in
`licence-server/secret/deploy/`. Keep that folder: without the id, the next run
would publish to a new URL.

## One-time setup, by hand (if the automatic way is not possible)

### 1. Make the sheet and paste the script

1. In Google Drive (the company account), make a new Google Sheet named
   **TenderAssist Licences**.
2. **Extensions → Apps Script**. In the editor:
   - Replace `Code.gs` with `licence-server/Code.gs` from this repo.
   - **+ → HTML**, name it `NewKey`, and paste `licence-server/NewKey.html`.
   - **Project Settings → Show "appsscript.json"**, then paste
     `licence-server/appsscript.json` into it.
   - Save.
3. Back in the sheet, reload. A **Licences** menu appears. Run **Licences → Set
   up / repair this sheet…** and allow access when Google asks.
   - Paste the private key when asked: the whole of
     `licence-server/secret/private-key.pem`. It is on the build PC only and
     never in git. Keep a copy in a password manager. Anyone with it can make
     keys the app accepts.
   - Paste the **client ID** of TenderAssist's Google sign-in. That is
     `client_id` in `google-licence-client.json` if you make one (step 3),
     otherwise in `google-oauth-client.json`.
4. On the **Settings** tab, fill **Contact shown to customers**, for example
   "Call 98xxx xxxxx or write to …". The app shows it on the lock screen.

### 2. Publish the key server

1. In the Apps Script editor: **Deploy → New deployment → Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
2. Copy the **Web app URL**, which ends in `/exec`.
3. Put it in **both** places, then build:
   - `src/licence/licenceServer.ts`: `LICENCE_SERVER_URL = 'https://script.google.com/macros/s/…/exec'`
   - `build/installer.nsh`: `!define LICENCE_SERVER_URL "https://script.google.com/macros/s/…/exec"`

   `npm run dist:win` refuses to build while these are empty or different.

When you change the script later, use **Deploy → Manage deployments → Edit →
New version**. That keeps the same URL. A *new* deployment gets a new URL and
would cut off installed apps.

### 3. Google sign-in for customers (important)

The app's Google sign-in for Drive is in **Testing** mode, which lets only the
listed test users sign in. Customers sign in with their own Google accounts, so
the licence sign-in needs a client that is **In production**.

Recommended: a separate Google Cloud project, **TenderAssist Licence**:

1. Make the project. Under **OAuth consent screen**, choose External with the
   app name and support email. Use **only** the scopes `openid` and `email`,
   which need no Google verification. Then **Publish app** (In production).
2. **Credentials → Create OAuth client ID → Desktop app**. Download the JSON as
   `google-licence-client.json` in the app folder, next to
   `google-oauth-client.json`. It is packed into the build and kept out of git.
3. Add its client ID in the sheet's script: Project Settings → Script
   properties → `GOOGLE_CLIENT_IDS`, comma separated if there are several.

Without `google-licence-client.json`, the app falls back to the Drive client.
That works only for that project's test users.

## Daily use (the Licences menu)

| To… | Do |
|---|---|
| Give a new customer a trial | **New key…** → Trial, days, PCs → copy the message → send it on WhatsApp or by email |
| Sell / renew | Change **Expires on**, or select rows → **Add 7 days** / **Change days…** (e.g. 30 or −3) |
| Price per PC | Set **PCs allowed** |
| Stop a key now | **Suspend selected keys** (or set Status to Revoked). It locks at the app's next check, within 6 hours, or at once on Check again |
| Customer changed PC | **Reset PCs of selected keys**, then they activate on the new PC |
| Customer changed Google account | **Free the Google account of selected keys** |
| Grace length | **Grace days** per key (empty = 3, 0 = lock right at the end) |

You never type in **Days left** or **PCs in use**: they are worked out live. Red
rows have ended or are not active; amber rows end within 3 days. Each morning
you get an email listing the keys ending within 3 days or in grace.

## Security notes

- Answers are signed (RSA-SHA256). The app holds only the public key
  (`src/licence/licenceServer.ts`), so editing `licence.json` on a PC, or
  faking the server, does not work.
- The PC ID is a hash of Windows' MachineGuid. Reinstalling the app keeps it;
  reinstalling Windows needs **Reset PCs**.
- Google's ID token is checked by the script with Google (`tokeninfo`): the
  account must be verified and the token made for TenderAssist's client.
- Development copies (`npm run electron`) do not check keys. Set
  `TENDERASSIST_LICENCE=on` to try the screens.
