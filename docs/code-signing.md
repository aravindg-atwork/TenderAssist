# Signing the Windows installer (no "Unknown publisher")

An unsigned installer makes Windows say **"Windows protected your PC … Unknown
publisher"** (SmartScreen) and makes antivirus more suspicious. A signed one
shows the company as the publisher. TenderAssist's build signs every `.exe`
(the app, the installer, the uninstaller) by itself once a certificate is set
up: `build/sign-windows.cjs`, called by electron-builder
(`package.json` → `build.win.signtoolOptions`).

## What to expect

- Signing gives **"Verified publisher: <your company>"** at once.
- SmartScreen also weighs **reputation**: a new certificate can still show the
  blue "Windows protected your PC" box (with **More info → Run anyway**) for the
  first few weeks of downloads. Since 2024 an EV certificate no longer skips this;
  OV and EV build reputation the same way. Reputation belongs to the
  certificate, so keep renewing the same one.
- To speed it up, submit each new installer to Microsoft as a software developer:
  <https://www.microsoft.com/wdsi/filesubmission> → "Software developer" →
  "Incorrectly detected as malware/malicious" → upload `TenderAssist-Setup-x.y.z.exe`.

Microsoft's own signing service (Azure Artifact Signing) is not open to
companies in India, so the certificate comes from a certificate authority.

## 1. Buy the certificate (once, then yearly)

Recommended: **SSL.com OV Code Signing with eSigner (cloud signing)**. The key
lives in SSL.com's cloud, so GitHub's build machines can sign without a USB
token. (Since 2023 every code signing key must be on a token or cloud HSM; a
`.pfx` file is no longer issued.)

1. <https://www.ssl.com/products/software-integrity/code-signing/> → **OV Code
   Signing** (Organization Validation), 1 year or more. Choose **eSigner cloud
   signing** for the key.
2. The order is for the **company's legal name** as registered (it appears as
   the publisher in Windows). Have ready:
   - certificate of incorporation / registration (or GST, Udyam/MSME, Shop &
     Establishment certificate),
   - a company phone number listed publicly (Google Business, Justdial, a
     government register) that SSL.com can call,
   - the authorised person's photo ID.
3. Validation takes about 1–5 working days, with a call to that phone number.
4. When issued: in the SSL.com account, open the certificate → **eSigner** →
   set up the **TOTP** (2-step code). Save:
   - the **SSL.com username** and **password**,
   - the **credential ID** (shown in the eSigner section),
   - the **TOTP secret** (the text behind the QR code; shown once when you set
     it up, so copy it before scanning).
5. An eSigner signing plan is needed for automated signing (SSL.com lists its
   plans; the smallest covers well over the few signatures a release needs:
   3 per Windows release).

## 2. Put it into GitHub (once)

GitHub → **aravindg-atwork/TenderAssist** → **Settings → Secrets and variables
→ Actions → New repository secret**:

| Secret | Value |
|---|---|
| `ESIGNER_USERNAME` | SSL.com username |
| `ESIGNER_PASSWORD` | SSL.com password |
| `ESIGNER_CREDENTIAL_ID` | eSigner credential ID |
| `ESIGNER_TOTP_SECRET` | eSigner TOTP secret |
| `GOOGLE_OAUTH_CLIENT_JSON` | the whole text of `google-oauth-client.json` |

`GOOGLE_OAUTH_CLIENT_JSON` is needed with or without signing: without it a
GitHub build has no Google sign-in, and the build now refuses to go on.

## 3. Release

Push a tag `v0.6.0`. The workflow downloads SSL.com's CodeSignTool (a fixed
version, checked by its SHA-256), signs while building, and attaches the
installer to a GitHub release. **A tagged release refuses to build unsigned.**
Until the certificate arrives, a release can still go out unsigned by setting
the repository **variable** (not secret) `ALLOW_UNSIGNED` to `true`; remove it
once signing works.

Check a signed installer: right-click → **Properties → Digital Signatures**
shows the company, "This digital signature is OK".

## Building on this PC

Without the `ESIGNER_*` variables a local build is left unsigned and says so
(`not signed (no code signing set up)`). To sign locally, unzip CodeSignTool
(<https://github.com/SSLcom/CodeSignTool/releases>, the `-windows.zip`) and set
`CODESIGNTOOL_DIR` to its folder with the four `ESIGNER_*` values.

## Updates

Installed copies update themselves from GitHub releases. A signed update
installs over an unsigned 0.5.x without trouble.
