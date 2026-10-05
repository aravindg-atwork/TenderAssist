# TenderAssist

TenderAssist is a desktop workflow for searching TN Tenders, reviewing the resulting favorites in My Tenders, and shortlisting work against saved product categories and intent keywords.

## Assisted portal login

Portal credentials are configured from **Settings → TN Tenders login**. The password is encrypted with the operating system's secure storage and is never returned to the renderer, written as plaintext to SQLite, or used to solve CAPTCHA.

When a job starts, TenderAssist opens Chrome, fills the saved login ID and password, focuses the CAPTCHA field, and waits. The user enters CAPTCHA and submits the portal form. If TN Tenders downloads `signData.jnlp`, TenderAssist validates its HTTPS source, host, path, filename, size, and JNLP content before displaying **Launch DSC signer**. Certificate choice and the DSC PIN remain entirely manual.

The DSC signer needs [OpenWebStart](https://openwebstart.com/download/) (Java Web Start). TenderAssist checks for it before a job starts and will not start without it, because sign-in cannot finish otherwise. If the portal page crashes or hangs during a run, TenderAssist reopens it and fills the saved login again; only CAPTCHA and DSC need you.

## How a run works

1. Choose **Published from** and **Published to**. Each date is searched on its own, with that date as the portal's published date, as a separate run in one sign-in. Dates that already have a completed run are skipped.
2. TenderAssist searches, screens each tender against your categories and intent, and downloads the documents and zip files for shortlisted and needs-review tenders into the local output folder, one day folder per published date. It does not stop to ask.
3. When every date is done, the portal stays signed in and TenderAssist offers **Run other published dates** or **Finish and sign out**.
4. Decide on tenders in the **Inbox**. Approving a tender copies its saved folder from the local output folder to the Drive folder. Nothing goes to Drive without approval.

## Run for development

```powershell
npm install
npm run electron
```

## Build a Windows installer

```powershell
npm run dist:win
```

The installable desktop opener is written to `release/TenderAssist-Setup-<version>.exe`. The installer creates Desktop and Start Menu shortcuts, so end users do not need a terminal.

## Build macOS disk images

Run this on macOS:

```bash
npm ci
npm run dist:mac
```

This creates x64 and Apple Silicon `.dmg` files in `release/`. Production distribution should add Windows code signing and Apple signing/notarization to remove operating-system trust warnings.
