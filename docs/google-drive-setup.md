# Uploading approved tenders to Google Drive: one-time setup

TenderAssist uploads approved tenders straight to Google Drive through Google's Drive API. Nothing needs installing on the computer.

There are two parts:

- **Once, for whoever builds TenderAssist** (steps 1–5, and 5a for choosing existing folders): register the app with Google and put its credential into the build.
- **For the operator** (step 6): choose a Drive folder, or type a folder name. The Google account comes from activating the key; operators never see a Client ID or secret, and never paste a link.

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

`drive.file` lets TenderAssist see and change only the files and folders it made, and folders the operator picks in Google's folder chooser (step 5a). Typing a name can never find an existing folder; choosing it in Drive can.

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

## 5a. Let operators choose a folder they already have (Google Picker)

Without this step, Settings only offers a folder name (a new folder in My Drive). With it, Settings also has **Choose a folder in Drive**, which opens Google's own folder chooser: My Drive, **Shared with me** and **Shared drives**.

1. In the same Google Cloud project, go to **APIs & Services → Library**, search for **Google Picker API**, and choose **Enable**.
2. Go to **APIs & Services → Credentials → Create credentials → API key**.
3. Edit the key:
   - **API restrictions**: Restrict key → only **Google Picker API**.
   - **Application restrictions**: leave **None**. The chooser opens from a page on the operator's own computer (`http://127.0.0.1:<port>`), and the port changes every time, so a website restriction would block it.
4. Add the key to `google-oauth-client.json`, inside `"installed"`, next to `client_id`:

   ```json
   { "installed": { "client_id": "…", "client_secret": "…", "picker_api_key": "AIza…", … } }
   ```

5. For GitHub builds, update the repository secret `GOOGLE_OAUTH_CLIENT_JSON` with the whole new file text (docs/code-signing.md).

The API key only opens the chooser. Every choice is still made by the signed-in operator, and TenderAssist gets that one folder, nothing else.

## 6. In TenderAssist (the operator)

1. **Activate the key** on first start: paste the key, then sign in with Google in the browser and leave the Google Drive box ticked. This one sign-in is also Drive's: nothing to sign in to again in Settings.
2. Open **Settings → Folders → Upload to Google Drive** and either:
   - choose **Choose a folder in Drive**, pick a folder in My Drive, **Shared with me**, or **Shared drives** in the browser, and choose **Select**. You need to be able to add files to it: an Editor of a shared folder, or a Content manager of a shared drive. Or:
   - type a **folder name** (for example `Tenders 2026-27`, or `Office/Tenders` for a folder inside a folder) and choose **Save the folder name**. TenderAssist makes the folder in **My Drive** (or finds the one it made before).
3. **Open in Drive** shows the folder.

If the Google Drive box was unticked, or the sign-in was removed in the Google account, Settings says so and has **Sign in to Google**. **Use another Google account** uploads somewhere else; the folder is then made in that account's Drive.

A typed name always means a folder TenderAssist makes: if you already have one with that name, TenderAssist makes its own next to it, because it cannot see yours. To use yours, choose it in Drive. Move or share TenderAssist's folder in Drive as you like: it keeps uploading into it. If a folder made by name is deleted, it is made again at the next upload. A **chosen** folder is never made again: if it is deleted or no longer shared with you, uploads stop with a message to choose a folder again.

## What happens next

- **Drive keeps the same files as this computer**, month by month and day by day:

  ```
  My Drive / <folder name> / October-2026 / 12-10-2026 / Approved-Tenders-12-10-2026 - Tamil Nadu.xlsx
                                                       / Approved-Tenders-12-10-2026 - GeM.xlsx
                                                       / 12-10-2026_1_<short title> / Documents / …
                                                                                  / Eligibility.xlsx
  ```

- **Report sheets**: one per website each day by default; every search of that website that day is on it. Settings → Folders → Report sheets → **One sheet for the day** puts every website on one sheet, with a Website column. Changing it rewrites saved days, on this computer and on Drive (old sheets go to Drive's bin).
- Tenders kept on the day sheet go to Drive with their documents and Eligibility.xlsx: ones TenderAssist shortlisted and ones you approved. Tenders needing a look stay on this computer until you approve them; rejected ones never go.
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
