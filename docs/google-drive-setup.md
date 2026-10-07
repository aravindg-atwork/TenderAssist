# Uploading approved tenders to Google Drive: one-time setup

TenderAssist uploads approved tenders straight to a Google Drive folder through Google's Drive API. Nothing needs to be installed on the computer, but Google needs to know about TenderAssist once. Someone who can manage the company's Google account does steps 1–4, about 10 minutes. The operator does step 5.

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

## 5. In TenderAssist (the operator)

1. Open **Settings → Folders → Upload to Google Drive**.
2. Paste the **Drive folder link** (open the folder in Drive and copy the browser address), the **Client ID** and the **Client secret**. Choose **Save these details**.
3. Choose **Sign in to Google**. The browser opens: choose the account and allow access. When the page says "Signed in", go back to TenderAssist.
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
