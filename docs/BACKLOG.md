# TenderAssist Product Backlog

This backlog prioritizes reliable daily use over feature volume. The product should remain deterministic and explainable: automation may recommend, but users can always see why a tender was kept, rejected, or sent for review.

## Product direction (2026-09-24)

TenderAssist is a daily tender operations workspace, not only a portal automation tool. The operator thinks in tenders, not jobs:

Discover → Screen → Review → Approve → Collect documents → Evaluate eligibility → Prepare response → Track outcome

- **Jobs become the technical layer.** A tender is a durable record keyed by portal and tender ID that outlives the job that found it. Runs remain visible for failures and diagnostics.
- **AI stays advisory.** Final approval, portal login, CAPTCHA, OTP, DSC, and submission remain explicit human actions.
- **Single-operator desktop tool (working decision).** DSC tokens, CAPTCHA, and OTP are bound to one person at one machine; credentials live in the OS vault and data in local SQLite. Stakeholders see outputs through the shared Drive folder. Revisit team features only after one operator runs it reliably every day.
- **Each portal is its own adapter.** Portals define their own authentication and navigation stages; GeM does not reuse the GePNIC flow.

### Confirmed workflow and usability decisions (2026-09-24)

- **No dashboard for now.** The product stays focused on Inbox, Tenders, Runs, and Settings. A dashboard or Today screen is deferred until the core daily workflow proves that it needs one.
- **Keep the authenticated portal session alive through portal work.** Do not log out after search or classification. Keep the embedded browser session alive while the operator reviews the shortlist, selects tenders, and downloads or retries every selected portal document. Log out only after portal-dependent work is complete, the user stops the run, or an unrecoverable failure ends it. Local OCR, extraction, workbook generation, and Drive copying may continue after logout because they do not require the portal.
- **Layout changes must never interrupt the portal.** Resizing, compressing, hiding, or focusing either panel must not reload the portal, lose authentication, stop automation, or interrupt downloads.
- **Design for nontechnical operators.** Every active step must state what is happening, whether the user is needed, what to do next, and what is safe to do while waiting.
- **Readable display is a product requirement.** Support larger application text, independent portal zoom, Windows display scaling, and small laptop screens without clipping actions or forcing application-level horizontal scrolling.

## Where we left off (2026-09-24)

### Done today (committed on master, not pushed)

- Text size (Standard / Large / Extra large) and per-portal zoom (80–200%) — `a75c58c`.
- File → Back up data / Restore from backup; Help → Export support bundle — `07f393a`.
- Sign in again and continue downloads when the portal session expires mid-run — `ee97d88`.
- Resizable run workspace: Instructions / Balanced / Portal layouts, divider, tabs below 1120 px — `dc5491d`.
- Continue job: an interrupted run resumes from its shortlist or document collection on the same job — `ae05eac`.
- Tender selection moved into the live run panel beside the signed-in portal; the Tender review page no longer selects — `ea55747`.
- Bounded retries for search, tender details, and My Tenders; failed categories are recorded and shown — `fed8c49`.
- "No tender matched your filters" summary with per-category counts, intent used, and Edit categories and intent — `05a6e16`.

### Next up (in this order)

1. **Live checks with a real portal session.** Nothing above has been exercised against a real TN Tenders sign-in yet: the live tick list after screening, re-sign-in after a real session timeout, and Continue job through sign-in into downloads.
2. **Selector health checks.** Fail clearly when the portal's page structure changes instead of reading it as empty results (blocked on open question 1).
3. **Invalid, locked, or expired portal credentials:** specific recovery guidance at sign-in.
4. **DSC readiness diagnostics:** token presence guidance, Java/OpenWebStart runtime check, and Open file location / Retry download when the signer fails to launch.
5. **In-app diagnostics panel** (the support bundle export exists; a readable in-app view does not).
6. **First-run onboarding:** Display text size choice with a live preview, readiness check, and a sample result explaining KEEP / REJECT / NEEDS REVIEW.
7. **Branded, signed releases:** TenderAssist app and installer icons, Windows Authenticode signing (needs a certificate), release channel shown in Settings.
8. **Full display test matrix:** 1024×768 to 1920×1080, Windows scaling 100/125/150%, all three text sizes, portal zoom 100–200%.
9. Then continue the recommended delivery order below (OCR English + Tamil, source-linked extraction, company profile, calendar, GeM adapter).

### Open questions for the operator

1. **Zero-results page.** When a TN Tenders category has no tenders for the date, does the results page still show the results table (with a "no records" line), or does the table disappear? TenderAssist currently reads "no table found" as 0 tenders, so a portal error page or a layout change looks the same as an empty category. A saved copy of that page (Ctrl+S) would settle it.
2. **Signing certificate.** Windows Authenticode signing needs a code-signing certificate (and Apple Developer ID for macOS). Who will purchase/hold it?
3. **App icon.** Is there an existing TenderAssist or Bow & Baan logo to use for the application and installer icons, or should a simple mark be designed?
4. **Runs interrupted before the shortlist** currently start again from the search. Is that acceptable, or should a partially finished search skip the categories it already completed?

## Delivered in 0.3.0 (2026-09-23)

- Added the 48 portals from the official Government of India participating-sites directory, grouped in one selector.
- Kept Tamil Nadu as the verified reference flow and labelled the other GePNIC adapters as beta until live-verified.
- Scoped login ID, encrypted password, local output root, and optional Drive sync root to each portal.
- Added the five most recent completed dates and highlighted possible missed dates for the selected portal.
- Added Department and State to tender review cards, audit tables, persistence, and Excel reports.
- Preserved existing TN credentials, job configurations, and output settings through backward-compatible migration.

### Multi-portal follow-up still required

- Run a controlled login, CAPTCHA handoff, DSC download, search, My Tenders review, and document download certification for each beta portal.
- Store adapter health/version results and disable only the broken phase when a portal changes markup.
- Add portal-specific category discovery so settings are not dependent on manually copied filter labels.

### GeM adapter discovery (2026-09-24)

GeM is not a GePNIC skin and must not reuse the existing CAPTCHA/DSC adapter. Public inspection confirmed:

- Public bid discovery is available at `https://bidplus.gem.gov.in/all-bids` without authentication, with keyword search, bid-type filters, bid-value filters, end-date filters, pagination, and public bid-document links.
- GeM sign-in is hosted separately at `https://sso.gem.gov.in/ARXSSO/oauth/login`.
- The first sign-in screen requests GeM user ID and CAPTCHA; it explicitly states that the password is entered on the next screen.
- GeM documentation also describes authenticator-generated one-time passwords for MFA. CAPTCHA and OTP must remain human-entered and must never be read, stored, replayed, or solved by TenderAssist.

Before GeM becomes selectable for live runs, add a dedicated adapter for public bid search/parsing and a separately certified assisted-auth flow. Capture the authenticated screens only with a user-provided test account and keep GeM disabled until those fixtures and recovery states are verified.

## Product success measures

- Fewer than 5% of reviewed tenders end as technical `UNCERTAIN` results.
- At least 80% of `KEEP` decisions are confirmed as relevant by the user.
- A user can configure and start their first job in under three minutes.
- Every interrupted job can explain where it stopped and how to retry safely.
- Application updates preserve jobs, settings, browser profile, and review decisions.

## P0 — Distribution and operational safety

### Automatic application updates

- Add `electron-updater` to the installed application.
- Check for updates at startup and from Settings.
- Download in the background and ask before restarting to install.
- Publish signed NSIS artifacts plus update metadata from CI.
- Build both DMG and ZIP artifacts for macOS updates.
- Support staged rollout and rollback through a newer corrective release.
- Preserve application data stored outside the installation directory.

### Signed, branded releases

- Replace the default Electron icon with TenderAssist application and installer icons.
- Add Windows Authenticode signing.
- Add Apple Developer ID signing and notarization before macOS distribution.
- Show the installed version and release channel in Settings.

### Job recovery and diagnostics

- Persist the active phase, current category, and last successfully handled tender.
- Detect an interrupted run at launch and offer Resume, Retry phase, or End job.
- Use bounded retries for portal timeouts and transient navigation failures. *(2026-09-24: category search, tender detail review, and opening My Tenders retry up to 3 times on timeouts or dropped connections, never after sign-out or cancel. Favouriting, sign-in, DSC, and downloads are never retried automatically. A category that still fails is recorded with its reason and shown on the run's review page instead of being skipped silently.)*
- Add a user-readable diagnostics panel and an exportable support bundle with secrets removed. *(2026-09-24: Help → Export support bundle… writes a JSON file of version, OS, preflight, table counts, recent runs and state changes, and settings; login IDs and passwords are reduced to saved/not-saved flags. The in-app diagnostics panel is still open.)*
- ~~Backup and restore.~~ Delivered 2026-09-24: File → Back up data… writes a single consistent SQLite copy without saved portal passwords; File → Restore from backup… validates the file, refuses backups from newer versions or while a job runs, and swaps it in at restart while keeping the replaced database beside it.
- Add selector health checks so portal markup changes fail clearly instead of silently producing empty results. *(Open question: a missing results table is still read as zero tenders, because we have no captured example of the portal's real zero-results page to tell the two apart.)*
- Resume from the exact failed stage rather than the start of the job. *(2026-09-24: done from the shortlist onward. The confirmed tender selection is saved with the job; "Continue job" on an interrupted run reopens the shortlist or resumes document collection on the same job, signs in only if a document still has to be downloaded, and skips saved files. Runs interrupted before the shortlist still start again, since search and screening must see the portal as it is now.)*
- Retry safe failures automatically (timeouts, transient navigation); require a manual retry for sensitive actions (login, DSC, document acquisition).
- If the portal session expires while the job is waiting for document selection or downloading, preserve the shortlist and completed files, request sign-in again, and resume acquisition without repeating discovery or classification. *(2026-09-24: done within a running job. A document request that lands on the portal's unauthorized/sign-in page stops acquisition without saving that page or failing the document; the job asks for a fresh sign-in in the same embedded portal (up to 3 times) and continues with the same selection, skipping files already saved. Not yet covered: resuming after TenderAssist itself was closed, which needs the selection persisted per job. Not yet verified against a live portal timeout.)*
- Record the last successfully downloaded document and keep partial-download retry decisions explicit.

### Output safety and audit history

Delivered on 2026-09-24: configurable `Month/Day/NN_Title` output structure, same-day conflict rules, and frozen per-job output plans. Jobs sharing a day folder continue its S.No sequence, and later runs write `Approved-Tenders-… (run N).xlsx` beside the first. Each job's root, date, and templates are saved at first publish, so template changes never move earlier jobs. Numbers from deleted jobs are never reused because their folders stay on disk.

- ~~Export an audit history covering searches, decisions, downloads, and manual overrides.~~ Delivered 2026-09-24: File → Export audit history… writes one time-ordered Excel sheet of tender events, run and sign-in states, searches, and document downloads (with SHA-256).
- Include output-folder writability and Drive sync-root availability in the preflight health check.

### Browser readiness

- Add a preflight check for Chrome availability, portal reachability, profile lock, and database writability.
- Show actionable recovery text before a job starts.
- Prevent duplicate browser sessions and safely reclaim stale automation profiles.
- Verify that panel resize, focus-mode changes, application zoom, portal zoom, and temporarily hidden portal views preserve the same authenticated WebContents session.

### Secure assisted portal sign-in

Core flow delivered on 2026-09-22: OS-encrypted credential storage, Settings controls, credential prefill, CAPTCHA focus, and an explicit in-app handoff state. Remaining work is portal-specific invalid/locked/expired credential guidance and selector health diagnostics.

- Store the portal login ID in Settings and keep the password in the operating-system credential vault, never plaintext SQLite, logs, exports, or crash reports.
- Add an explicit Remember password toggle plus Replace and Forget credential actions.
- On Start job, open the portal login page and fill the saved login ID and password.
- Pause with a clear `Captcha required` state, focus the CAPTCHA field, and wait for the user to enter and submit it.
- Never read, solve, transmit, store, or replay CAPTCHA values.
- Detect invalid credentials, locked accounts, expired passwords, and changed portal login markup with specific recovery guidance.
- Clear decrypted credential material from application state immediately after form entry.

### Human-controlled DSC/JNLP handoff

Core flow delivered on 2026-09-22: trusted-download validation, protected local capture, explicit signer launch, and human-only certificate/PIN interaction. Remaining work is readiness diagnostics, file-location/retry actions, and safe audit events.

- Add a DSC readiness check for token presence guidance, JNLP file association, and a supported Java Web Start/OpenWebStart runtime.
- Detect the portal-generated `signData.jnlp` download and verify its extension, source portal, expected filename pattern, and safe local path.
- Show the source and file details, then require the user to select `Launch DSC signer`; never execute a downloaded JNLP silently.
- Open the verified JNLP through the registered system handler or configured OpenWebStart executable.
- Keep certificate selection, DSC token interaction, consent, and DSC PIN/password entry human-only.
- Detect signer launch failure and provide Open file location, Retry download, and runtime setup guidance.
- Never store or automate the DSC PIN/password.
- Record only safe audit events such as `CAPTCHA_HANDOFF`, `JNLP_DOWNLOADED`, `SIGNER_LAUNCHED`, and `DSC_LOGIN_CONFIRMED`.

### Authenticated browser lifetime

- Keep the embedded portal open through authentication, search, classification, human shortlist review, document selection, document download, and portal-download retry decisions.
- Never allow logout to race an active request or document download.
- When every selected portal document has either downloaded successfully or reached a user-confirmed terminal failure, attempt a best-effort server-side logout before closing the embedded browser.
- On Stop job, fatal failure, or normal completion, attempt logout and then close the embedded view without discarding already saved work.
- If the application crashes, preserve the run checkpoint and rely on the portal's own session timeout; on restart, explain that a fresh sign-in may be required.
- Permit local OCR, requirement extraction, Excel generation, and Drive-folder copying to continue after portal logout.

## P1 — Shortlist quality and human review

### Tender-centric data model

Prerequisite for the Inbox, duplicate detection, corrigendum linking, and outcome tracking.

- Store each tender once, keyed by portal and tender ID, and link it to every job that saw it.
- Track a tender lifecycle separate from job state and portal state: New → Screened → Approved / Rejected / Deferred → Documents collected → Eligibility reviewed → Preparing → Submitted / Not submitted → Won / Lost / Cancelled / Expired.
- Keep every state change as an audit event with actor (automation or user), timestamp, and optional note.
- Migrate existing per-job tender rows without losing decisions.

### Review inbox

- Give `UNCERTAIN` tenders a dedicated queue, separate from the shortlist.
- Show clear matches and uncertain tenders separately, each with a plain explanation of why it was kept, rejected, or marked uncertain.
- Allow manual Approve, Reject, Defer, and Recheck decisions with an optional note.
- Allow bulk decisions for high-confidence results behind a clear confirmation.
- Retry only the failed detail review instead of rerunning the complete job.
- Preserve automated and human decisions as separate audit records.

### Relevance feedback loop

- Let users mark shortlisted results as Relevant or Not relevant.
- Summarize repeated rejection reasons and suggest new exclusions or intent phrases.
- Require user approval before changing saved relevance settings.
- Track precision by category and keyword without introducing opaque model-only decisions.

### Better matching controls

- Support required phrases, optional phrases, and negative phrases.
- Add category-specific intent profiles instead of one global keyword list.
- Add organisation allowlists/blocklists and tender-value thresholds.
- Detect procurement verbs and deliverables separately from incidental contract text.
- Add a test workspace where settings can be evaluated against historical tenders before saving.

### Duplicate and change detection

- Detect tenders already seen in previous jobs, across dates and portals.
- Link corrigenda to their original tender and highlight date extensions, value changes, and document revisions. *(2026-09-24: storage, change classification, cancellation, and Inbox wording done; the TN Tenders corrigendum-listing parser waits for a captured detail page.)*
- Group similar opportunities (same buyer, overlapping scope) for comparison. *(2026-09-24: possible-retender links by reference or near-identical title, with Not related dismissal.)*
- Avoid repeating unchanged tenders in the daily review queue.

### Relevance scoring

- Add a transparent relevance score alongside KEEP/REJECT, built from visible matched signals.
- Use past approvals and rejections only to suggest rule changes the user accepts; never adjust scores silently.

## P1 — Document acquisition and reporting

### Download shortlisted tender documents

- Start acquisition only for `KEEP` tenders or manually approved review items.
- Create one job folder and one subfolder per tender using stable, sanitized names.
- Download every available tender document with checksum, source URL, and retrieval timestamp.
- Retry partial downloads and show missing-file status without losing completed files.
- Keep the authenticated portal session alive while the user chooses documents and until all selected downloads and portal-side retries are finished.
- Show document progress in plain language, for example `Downloading 3 selected tenders — 2 of 3 complete`.
- Preserve the shortlist, selection, completed files, checksums, and failure reasons if the portal session expires.

### Requirement extraction

- **Prerequisite:** OCR for scanned/image-only PDFs with English and Tamil (`eng+tam`); without it, Tamil pages become garbage text with no visible error. Flag low-confidence pages.
- Extract into structured areas: technical eligibility, financial eligibility, prior experience, certifications, EMD and fees, mandatory documents, important dates, submission method, scope, and contacts.
- Link every extracted fact to its source document and page, and show source and extraction side by side.
- Let the user correct extracted values and mark each requirement Met, Not met, Unknown, or Needs evidence.
- Flag risk indicators: unclear scope, short deadlines, restrictive eligibility, missing documents.
- Produce a tender checklist and draft compliance matrix instead of an untraceable prose summary.
- Detect updated or replaced documents on the portal after first download.

### Drive and Sheets publishing

- Create a configurable Drive root folder, job folder, and tender folders.
- Upload source documents and generated summaries without duplicating unchanged files.
- Create or update a master Sheet with one row per tender.
- Include status, owner, deadline, decision, Drive link, and extraction confidence.
- Record upload failures locally and allow safe retry.

## P1 — Core UI/UX

### Navigation

- Primary navigation for the current product: **Inbox** (tenders needing review), **Tenders** (approved and tracked), **Runs** (automation history and failures), and **Settings** (portals, credentials, rules, folders, and display preferences).
- Keep Calendar as a later workflow addition, not a reason to add a dashboard now.
- Move low-frequency commands to the native application menu: output folders and naming, import/export settings, open data or log folder, backup and restore, check for updates, keyboard shortcuts, about and diagnostics.
- Keep frequent actions in the main UI: start discovery, approve/reject, select documents, retry failed stage, open tender folder, view source tender.
- Use human-readable timestamps everywhere instead of raw ISO dates.
- Show a progress timeline per tender and keep portal, job, and tender state visibly distinct.
- Persist filters and saved views; search across title, department, reference, and extracted requirements.
- Write empty states that name the next action.

### Daily workspace — no dashboard for now

- Do not build a dashboard or Today screen in the current roadmap.
- Open on Inbox when decisions need attention; otherwise keep Runs as the place to start discovery.
- Keep Inbox, Tenders, Runs, and Settings as the complete primary information architecture.
- Add deadline information where the tender is reviewed instead of introducing summary cards and charts.
- Revisit a dashboard only after daily-use evidence shows that operators cannot understand priorities from Inbox and Tenders.

### Live job progress

- Show the active orchestration phase, current product category, pages scanned, tenders found, and tenders reviewed.
- Distinguish waiting for login from running automatically.
- Provide safe Cancel and Retry controls at phase boundaries.
- Keep the window useful while Chrome is open instead of showing only a generic running state.
- Keep the current authenticated browser alive when the portal panel is resized, compressed, temporarily hidden, or placed behind an Instructions view.
- Explain whether the operator may safely wait, navigate elsewhere inside TenderAssist, or must act in the portal.

### Adaptive run workspace

Delivered on 2026-09-24: draggable, keyboard-accessible divider (320–720 px guide, portal never under 640 px); Instructions/Balanced/Portal presets remembered between runs; a wider default split when large text is on below 1440 px; optional "Automatically focus the current task"; Instructions/Tender portal tabs below 1120 px with an "action needed" hint; window minimum lowered to 900 × 620. The portal view is only moved or hidden, never reloaded (verified: same portal WebContents and URL across every layout change). Not yet run: the full resolution × scaling × text-size matrix.

- Replace the fixed-width run sidebar with a resizable split workspace and a keyboard-accessible divider.
- Provide three plain-language presets:
  - **Instructions:** approximately 60% guidance and 40% portal for reading, review, errors, and waiting.
  - **Balanced:** approximately 35% guidance and 65% portal for normal operation.
  - **Portal:** approximately 20–25% guidance and 75–80% portal for CAPTCHA, forms, and detailed portal pages.
- Remember the operator's last chosen split and respect manual changes for the rest of the run.
- Offer an optional `Automatically focus the current task` preference. When enabled, recommend or gently switch focus for human-action, automatic-work, review, download, and completion states without destroying either panel.
- Keep the portal mounted in the same authenticated session in every focus mode; changing visibility or bounds must not navigate, reload, or recreate it.
- At 1440 px and wider, support the full split view with a left-panel range of roughly 320–720 px and at least 640 px for the visible portal.
- At 1120–1439 px, retain the resizable split view with safe wrapping and a larger initial instruction width when large text is enabled.
- At 900–1119 px, stop squeezing two unusable panels. Present full-width **Instructions** and **Tender portal** views as tabs while keeping the hidden portal session alive and automation running.
- After the tabbed fallback is implemented, target an application minimum of approximately 900 × 620. Let the instruction area scroll independently while primary actions remain reachable.
- Never introduce application-level horizontal scrolling. A legacy portal may scroll inside its own viewport when unavoidable.

### Display size and zoom

Delivered on 2026-09-24: Settings → Display text size (Standard 16 px, Large 18 px, Extra large 20 px) applied instantly through a rem-based type scale with a 14 px supporting floor and 44 px buttons; portal toolbar zoom (−, percentage/reset, +) from 80% to 200% in 10% steps, remembered per portal and applied to the embedded WebContents without reloading it. Still open: first-run Display choice and the full resolution/scaling test matrix.

- Add **Settings → Display → Text size** with persistent `Standard`, `Large`, and `Extra large` options.
- Use an ordinary body-text floor of 16 px for Standard, approximately 18 px for Large, and approximately 20 px for Extra large. Operational instructions must not be smaller than the selected body size, and supporting information must not fall below a readable 14 px equivalent.
- Replace the current collection of fixed 9–13 px operational labels with semantic `rem`-based typography roles that reflow when text grows.
- Keep buttons and essential interactive targets at least 44 × 44 px where practical, with clear focus indicators and comfortable spacing.
- Preserve operating-system font rendering and Windows scaling; do not implement text enlargement with CSS transforms that merely magnify clipped layouts.
- Add independent portal zoom controls to the portal toolbar: decrease, current percentage, increase, and reset.
- Support portal zoom from 80% to 200% in 10% steps and remember it separately for each portal.
- Apply portal zoom to the embedded portal WebContents rather than assuming application zoom affects it.
- Keep application text size and portal zoom separate so an operator can enlarge instructions without making a legacy portal unusable, or enlarge the portal without overcrowding TenderAssist.

### Client-friendly operational guidance

- Design for clients who understand their tender work but may not understand browser automation, state machines, storage, or system terminology.
- Every active step must answer four questions: **What is happening? Does TenderAssist need me? What should I do next? What is safe to do while I wait?**
- Replace technical state labels in primary copy with plain actions such as `Waiting for portal sign-in`, `Checking tender relevance`, and `Downloading selected documents`.
- Keep job IDs, raw states, timestamps, and diagnostics under a secondary `Technical details` disclosure.
- Show one dominant action per step and distinguish `TenderAssist is working`, `Your action is required`, `Waiting safely`, and `Something needs attention` with text and icons, never color alone.
- For failures, explain what happened, what was already saved, what the operator should do, and whether retrying repeats work.
- Do not require keyboard shortcuts; expose them only as optional accelerators alongside visible controls.
- Add a first-run Display choice with a live text preview and a reminder that it can be changed later.

### Tender review workspace

- Add search, decision filters, category filters, and sorting by date/value.
- Open tender details in a side panel so the review position is preserved.
- Keep the full title visible and make long metadata scannable.
- Add Previous/Next review navigation and keyboard shortcuts.
- Allow two tenders to be compared on scope, eligibility, dates, value, and matched intent.

### Settings improvements

- Offer named relevance profiles such as Software, Media, and Combined.
- Validate portal category names and suggest exact known values.
- Explain the effect of each setting with a small matching example.
- Show unsaved changes and provide Restore defaults.
- Add Import/Export settings for moving to another computer.

### First-run onboarding and help

- Add a three-step readiness flow: Chrome, relevance settings, test run.
- Include a small sample result explaining KEEP, REJECT, and NEEDS REVIEW.
- Add contextual help for login waiting, portal errors, and empty results.
- Avoid forced tours after the first successful run.

### Accessibility and efficiency

- Verify keyboard-only use, logical focus order, screen-reader names, and WCAG AA contrast.
- Add shortcuts for Start job, Settings, search, next tender, Keep, and Reject.
- Announce asynchronous status changes through accessible live regions.
- Test long titles, 200% zoom, narrow windows, empty states, and large job histories.
- Verify the complete run workflow at 1024×768, 1280×720, 1366×768, 1440×900, and 1920×1080.
- At each representative resolution, test Windows scaling at 100%, 125%, and 150%; application text at Standard, Large, and Extra large; and portal zoom at 100%, 125%, 150%, and 200%.
- Test every Instructions, Balanced, and Portal focus mode during CAPTCHA, DSC, search, waiting, error, document download, retry, and completion states.
- Acceptance criteria: no clipped primary action, no application-level horizontal scroll, no portal-session loss during layout changes, downloads continue when the portal is compressed or hidden, and the operator can always tell whether action is required.

## P2 — Advanced automation

### Scheduling and notifications

- Support scheduled daily runs with a quiet background mode.
- Notify only for completion, failure, login required, or new high-confidence matches.
- Respect working hours and allow missed jobs to be run on demand.

### Company profile and bid/no-bid

- Store a company profile: turnover, experience, certifications, registrations, and standard documents.
- Run eligibility gap analysis of each approved tender against the profile.
- Offer a bid/no-bid recommendation with reasons; the operator decides.
- Offer an optional management summary generated from the source-linked extraction.

### Preparation and outcome tracking

- Build a document checklist per tender and track readiness; never attempt automatic submission.
- Record the outcome (Submitted, Not submitted, Won, Lost, Cancelled, Expired) and keep the complete audit trail and final documents.

### Deadline intelligence

- Build a calendar of closing dates, pre-bid meetings, clarification deadlines, and opening dates.
- Warn about closing-soon tenders; account for holidays, extensions, and missed dates.
- Detect deadline collisions and tenders requiring immediate action.
- Export selected dates to calendar providers after explicit user approval.

### Multi-portal architecture

- Formalize the current shared GePNIC implementation behind search, detail, document, and authentication adapter contracts.
- Keep TN Tenders as the verified reference while certifying the 47 beta portal profiles.
- Add recorded fixtures and selector health tests per portal version.

### Team workflow (deferred until the single-operator decision is revisited)

- Add owner, reviewer, notes, and decision timestamps.
- Support shortlist approval before documents are published externally.
- Provide a read-only export for stakeholders who do not use the desktop app.

### Analytics

- Report tenders found, shortlist precision, common rejection reasons, category yield, and turnaround time.
- Keep analytics operational and decision-oriented; avoid vanity charts.
- Allow all analytics data to be exported and deleted locally.

## Recommended delivery order

Revised 2026-09-24 around the tender-centric workflow:

1. Harden recovery, retries, audit history, and same-day output behavior (plus updates, signing, readiness checks).
2. Add exact-stage recovery, portal-session-expiry recovery, partial-download retry, selector diagnostics, backup/restore, signed releases, and branded installers.
3. Deliver the adaptive run workspace, readable display sizes, independent portal zoom, and client-friendly operational guidance without adding a dashboard.
4. Complete the tender-centric Inbox-to-document workflow in one coherent tender workspace.
5. Add OCR (English + Tamil), then source-linked eligibility extraction and review.
6. Add company profile, bid/no-bid analysis, calendar, and readiness/outcome tracking.
7. Build the independent GeM adapter: public discovery, login checkpoint, human CAPTCHA/OTP, and session-expiry recovery that keeps the shortlist.
8. Add collaboration only if the single-operator decision changes.

## Explicitly avoid for now

- Fully autonomous bidding or submission.
- Hidden AI scoring with no evidence.
- Uploading every discovered tender before relevance review.
- Treating visual similarity as proof that a beta portal is fully compatible; every portal must pass the certification flow.
- Complex dashboards before the review and acquisition workflows are complete.
- A dashboard or Today screen without evidence that Inbox, Tenders, and Runs are insufficient.
- Logging out, reloading, recreating, or closing the portal session while shortlist selection or selected-document acquisition is still active.
- Making essential instructions smaller to preserve a dense layout.
