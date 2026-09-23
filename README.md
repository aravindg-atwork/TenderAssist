# TenderAssist

TenderAssist is a desktop workflow for searching TN Tenders, reviewing the resulting favorites in My Tenders, and shortlisting work against saved product categories and intent keywords.

## Assisted portal login

Portal credentials are configured from **Settings → TN Tenders login**. The password is encrypted with the operating system's secure storage and is never returned to the renderer, written as plaintext to SQLite, or used to solve CAPTCHA.

When a job starts, TenderAssist opens Chrome, fills the saved login ID and password, focuses the CAPTCHA field, and waits. The user enters CAPTCHA and submits the portal form. If TN Tenders downloads `signData.jnlp`, TenderAssist validates its HTTPS source, host, path, filename, size, and JNLP content before displaying **Launch DSC signer**. Certificate choice and the DSC PIN remain entirely manual.

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
