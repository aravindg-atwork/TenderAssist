# Licence keys: where we stopped (10 Oct 2026)

Pick up here tomorrow. How the system works is in `docs/licence-setup.md`.

## Decision needed first: how a person proves who they are

The plan was key = one **Google account**, proved by Google sign-in. That
needs a Google Cloud project with an "In production" sign-in client. The
**tenders@bowandbaan.com** account can only use Drive and sign-in, not Google
Cloud. The company's other account can do it, but not right now.

| | A. Email code (recommended) | B. Key + PC only, for now |
|---|---|---|
| How it works | Customer enters key + their email. The sheet emails a 6-digit code from tenders@. They type it. The key is now tied to that email. | Customer pastes the key and the PC is activated. |
| Keeps "one key = one account" | Yes, any email (Gmail or company) | No: only the PC limit stops sharing |
| Needs Google Cloud | No | No |
| Needs | tenders@ allowed to send email (the morning reminder needs it too) | Nothing |
| Effort | About half a day, incl. tests | About an hour |
| Google sign-in later | Keep the code; switch it on when the company account makes the Cloud client | Same |

Unchanged either way: the sheet, trial/paid, add or take days, grace days
then lock, 3 days offline, PCs per key, installer key page, Suspend, Reset PCs.

**To answer tomorrow:** A or B? For A, can tenders@bowandbaan.com send
email? (Send a normal email from it in Gmail.)

### What changes in the code for A
- `licence-server/Code.gs`: new action `send-code` (key + email → 6-digit
  code stored for 10 minutes in CacheService, emailed with MailApp, a limit
  on tries); `activate` accepts `email + code` as well as a Google `idToken`;
  first activation binds the email (the sheet's "Google account" column,
  renamed to "Account email").
- `src/licence/licenceManager.ts` and `renderer/src/components/Licence.tsx`:
  activation screen = key → email → "Send code" → code → Activate.
- Tests in `tests/licence/`, then run again against the local stand-in and the
  live server.

## What is live now

- **Sheet** (owner tenders@bowandbaan.com):
  https://docs.google.com/spreadsheets/d/1AvQqzDUcUPa104vmFomNm6Ye_n11VMbock0MuOrE4F4/edit
  Tabs Keys, PCs, Log, Settings exist (made by `prepareSheet`).
- **Script editor:**
  https://script.google.com/d/1lZROhicrqY0gNvvP04TWoAyfr46GRsFYPSnhO4fNUsm0QUo7tZ5xdvwM/edit
- **Key server (web app)**, already in `src/licence/licenceServer.ts` and
  `build/installer.nsh`:
  `https://script.google.com/macros/s/AKfycbxv6T28eEY342oou_V_f6NyjnKZ4syRmFkceDA3S5hIJ5eTmheP_LXL5OElTCD0QhdI/exec`
  Checked live: it answers, reads the sheet, and refuses an unknown key (app
  call and installer check).
- **Deploying changes:** edit `licence-server/Code.gs`, then
  `node licence-server/deploy.cjs`. It publishes on the same URL. It needs the
  clasp sign-in on this server (`~/.clasprc.json`, tenders@) and
  `licence-server/secret/deploy/` (holds the deployment id: keep it).

## Still to do

1. Decide A or B (above), then build it.
2. Make a test key in the sheet (**Licences → New key…**; if the menu does
   not show, use an Incognito window signed in only as tenders@) and test it
   live. Signed answers have only been tested against the local stand-in, not
   the live server.
3. Fill **Settings → B2** (contact shown to customers on the lock screen).
4. **Back up `licence-server/secret/private-key.pem`** (password manager).
   Losing it means replacing every key. It is also inside the script as
   `Secret.gs`.
5. Build an installer (`npm run dist:win`) and install it on a clean PC:
   key page → first start → activation → Settings → Licence.
6. Commit (nothing is committed yet). Do not commit `licence-server/secret/`
   (git-ignored) or `relay-token.txt`.
7. Later, with the company account: Google Cloud project + In-production
   sign-in client (`google-licence-client.json`), if Google sign-in is still
   wanted.

## Checked so far (10 Oct)

- Stamp on approve/reject: fixed; the owner confirmed it works.
- 30 licence tests pass. Type-check and build pass.
- Local stand-in running the real `Code.gs` (with Apps Script's redirect): key
  making, peek, activate, wrong account, PC limit, suspend, reset PCs, bad
  requests.
- Installer: compiles; key page shows; empty key refused; `check-key.ps1`
  handles good, wrong, suspended, offline, quotes in the key, and a web page
  instead of an answer (continues, never refuses).
- App against the stand-in: activate → shorten (warning strip) → suspend
  (lock; runs refused) → renew (Check again unlocks) → reset PCs (activate
  again).
- Not working on this server: the Chrome extension; remote-controlled
  browsers are blocked in this session.
