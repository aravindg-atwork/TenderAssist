# Uploading approved tenders to Google Drive: one-time setup

TenderAssist uploads approved tenders straight to a Google Drive folder through Google's Drive API. Nothing needs installing on the computer.

There are two parts:

- **Once, for whoever builds TenderAssist** (steps 1–5): register the app with Google and put its credential into the build.
- **For the operator** (step 6): paste the Drive folder link and sign in. Operators never see a Client ID or secret.

## 1. Create a project

1. Open <https://console.cloud.google.com> and sign in with the company Google account.
2. At the top, choose **Select a project → New project**.
3. Name it `TenderAssist` and choose **Create**.

## 2. Turn on the Drive API

1. Go to **APIs & Services → Library**.
2. Search for **Google Drive API**, open it, and choose **Enable**.

## 3. Consent screen

1. Go to **APIs & Services → OAuth consent screen** (also called "Google Auth Platform → Branding").
2. Choose the user type:
   - **Internal**, if the company uses Google Workspace (an email at the company's own domain). This is the best choice: Google does not need to review the app, and the sign-in does not expire.
   - **External**, with a personal Gmail account. Add the operator's Gmail under **Test users**. While the app stays in "Testing", Google ends the sign-in after **7 days**, and the operator signs in again in Settings.
3. Enter app name `TenderAssist` and your support email, then save.
4. Under **Data access** (scopes), you can add `.../auth/drive`. TenderAssist asks for it at sign-in anyway.

## 4. Desktop credentials

1. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Desktop app**. Name: `TenderAssist`. Choose **Create**.
3. Copy the **Client ID** (ends in `.apps.googleusercontent.com`) and the **Client secret**.

## 5. Put the credential into the build (developer)

1. In **Credentials**, download the Desktop client's JSON (the download icon).
2. Save it in the project root as `google-oauth-client.json`.
   - It is listed in `.gitignore`, so it is never committed.
   - `package.json` → `build.files` packs it into the app.
3. Build the installer as usual.
4. Settings shows "This copy of TenderAssist was built without Google sign-in" when the file is missing.

Google treats a Desktop app's client secret as part of the app, not as a password. Keeping it out of git still keeps it out of public view.

## 6. In TenderAssist (the operator)

1. Open **Settings → Folders → Upload to Google Drive**.
2. Paste the **Drive folder link** (open the folder in Drive and copy the browser address), then choose **Save the folder**.
3. Choose **Sign in to Google**. The browser opens: choose the account and allow access. When the page says "Signed in", go back to TenderAssist.
   - If no browser window opens, or it shows an error (for example Chrome's paused sign-in), choose **Copy the sign-in link** and open it in a private (Incognito) window.
4. Settings now shows "Signed in as … Uploading to …".

The signed-in account must be able to add files to the folder, which means Editor access.

## What happens next

- **When a tender is approved,** its folder (`Documents`, `Eligibility.xlsx`) and that day's report sheet are uploaded into the Drive folder, in the same layout as on the computer:

  ```
  <Drive folder> / 10-2026 / 06-10-2026 / Approved-Tenders-06-10-2026.xlsx
                                         / 06-10-2026_1_<short title> / Documents / …
                                                                      / Eligibility.xlsx
  ```

- **Files already on Drive and unchanged are not sent again.** A changed file replaces the old one.
- **Each tender's history** notes when it was uploaded. If an upload fails, a message says which tenders. The files stay safe on the computer, and approving again retries.
- **The sign-in is stored on this computer,** encrypted for the Windows account. It is never in backups or support bundles. **Sign out** in Settings stops all uploads.
