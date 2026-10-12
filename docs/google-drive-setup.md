# Uploading approved tenders to Google Drive: one-time setup

TenderAssist uploads approved tenders straight to Google Drive through Google's Drive API. Nothing needs installing on the computer.

There are two parts:

- **Once, for whoever builds TenderAssist** (steps 1–5): register the app with Google and put its credential into the build.
- **For the operator** (step 6): type a folder name. The Google account comes from activating the key; operators never see a Client ID or secret, and never paste a link.

## 1. Create a project

1. Open <https://console.cloud.google.com> and sign in with the company Google account.
2. At the top, choose **Select a project → New project**.
3. Name it `TenderAssist` and choose **Create**.

## 2. Turn on the Drive API

1. Go to **APIs & Services → Library**.
2. Search for **Google Drive API**, open it, and choose **Enable**.

## 3. Consent screen

1. Go to **Google Auth Platform → Branding**: app name `TenderAssist`, support email, home page and privacy policy links.
2. **Data access** (scopes): add exactly `openid`, `email` and `.../auth/drive.file`. Do not add `.../auth/drive`: full Drive access is a restricted scope that needs a yearly paid security assessment before customers can use it.
3. **Audience**: External, then **Publish app** (In production). With only non-sensitive scopes, any Google account can sign in, and sign-ins no longer end after 7 days.

`drive.file` lets TenderAssist see and change only the files and folders it made. That is why TenderAssist makes the upload folder itself.

## 4. Desktop credentials

1. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Desktop app**. Name: `TenderAssist`. Choose **Create**.

## 5. Put the credential into the build (developer)

1. In **Credentials**, download the Desktop client's JSON (the download icon).
2. Save it in the project root as `google-oauth-client.json`.
   - It is listed in `.gitignore`, so it is never committed.
   - `package.json` → `build.files` packs it into the app.
3. Put its client ID in the key server's `GOOGLE_CLIENT_IDS` (docs/licence-setup.md, step 3).
4. Build the installer as usual. Settings shows "This copy of TenderAssist was built without Google sign-in" when the file is missing.

Google treats a Desktop app's client secret as part of the app, not as a password. Keeping it out of git still keeps it out of public view.

## 6. In TenderAssist (the operator)

1. **Activate the key** on first start: paste the key, then sign in with Google in the browser and leave the Google Drive box ticked. This one sign-in is also Drive's: nothing to sign in to again in Settings.
2. Open **Settings → Folders → Upload to Google Drive**, type a **folder name** (for example `Tenders 2026-27`, or `Office/Tenders` for a folder inside a folder) and choose **Save the folder name**.
3. TenderAssist makes the folder in **My Drive** (or finds the one it made before). **Open in Drive** shows it.

If the Google Drive box was unticked, or the sign-in was removed in the Google account, Settings says so and has **Sign in to Google**. **Use another Google account** uploads somewhere else; the folder is then made in that account's Drive.

TenderAssist cannot see folders it did not make. If you already have a folder with the same name, TenderAssist makes its own next to it. Move or share TenderAssist's folder in Drive as you like: it keeps uploading into it. If it is deleted, it is made again at the next upload.

## What happens next

- **Drive keeps the same files as this computer**, month by month and day by day:

  ```
  My Drive / <folder name> / October-2026 / 12-10-2026 / Approved-Tenders-12-10-2026 - Tamil Nadu.xlsx
                                                       / Approved-Tenders-12-10-2026 - GeM.xlsx
                                                       / 12-10-2026_1_<short title> / Documents / …
                                                                                  / Eligibility.xlsx
  ```

- **Report sheets**: one per website each day by default; every search of that website that day is on it. Settings → Folders → Report sheets → **One sheet for the day** puts every website on one sheet, with a Website column. Changing it rewrites saved days, on this computer and on Drive (old sheets go to Drive's bin).
- Approved tenders go to Drive; tenders waiting for a decision stay on this computer, rejected ones never go.
- Files saved later, for example by "Collect their documents" or a rewritten report sheet, are uploaded as well.
- **"Upload everything saved so far"** in Settings sends everything already on the computer, including earlier days.
- **Files already on Drive and unchanged are not sent again.** A changed file replaces the old one.
- **Results:**
  - each tender's history notes its upload;
  - a Windows notification says when an upload finished;
  - if an upload fails, a message names what failed. The files stay safe on the computer, and "Upload everything saved so far" retries.
- **The sign-in is stored on this computer,** encrypted for the Windows account. It is never in backups or support bundles. **Sign out of Drive** stops all uploads.

## PCs set up with a folder link

Earlier versions asked for a Drive folder link and full Drive access. A PC set up that way keeps uploading to its old folder until the folder name is changed or Google is signed in again; after that, TenderAssist makes its own folder by the name.
