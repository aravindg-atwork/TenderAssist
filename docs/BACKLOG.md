# TenderAssist Product Backlog

This backlog prioritizes reliable daily use over feature volume. The product should remain deterministic and explainable: automation may recommend, but users can always see why a tender was kept, rejected, or sent for review.

## Product direction (2026-09-24)

TenderAssist is a daily tender operations workspace, not only a portal automation tool. The operator thinks in tenders, not jobs:

Discover → Screen → Review → Approve → Collect documents → Evaluate eligibility → Prepare response → Track outcome

- **Jobs become the technical layer.** A tender is a durable record keyed by portal and tender ID that outlives the job that found it. Runs remain visible for failures and diagnostics.
- **AI stays advisory.** Final approval, portal login, CAPTCHA, OTP, DSC, and submission remain explicit human actions.
- **Single-operator desktop tool (working decision).** DSC tokens, CAPTCHA, and OTP are bound to one person at one machine; credentials live in the OS vault and data in local SQLite. Stakeholders see outputs through the shared Drive folder. Revisit team features only after one operator runs it reliably every day.
- **Each portal is its own adapter.** Portals define their own authentication and navigation stages; GeM does not reuse the GePNIC flow.

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
- Use bounded retries for portal timeouts and transient navigation failures.
- Add a user-readable diagnostics panel and an exportable support bundle with secrets removed.
- Add selector health checks so portal markup changes fail clearly instead of silently producing empty results.
- Resume from the exact failed stage rather than the start of the job.
- Retry safe failures automatically (timeouts, transient navigation); require a manual retry for sensitive actions (login, DSC, document acquisition).

### Output safety and audit history

Delivered on 2026-09-24: configurable `Month/Day/NN_Title` output structure, same-day conflict rules, and frozen per-job output plans. Jobs sharing a day folder continue its S.No sequence, and later runs write `Approved-Tenders-… (run N).xlsx` beside the first. Each job's root, date, and templates are saved at first publish, so template changes never move earlier jobs. Numbers from deleted jobs are never reused because their folders stay on disk.

- ~~Export an audit history covering searches, decisions, downloads, and manual overrides.~~ Delivered 2026-09-24: File → Export audit history… writes one time-ordered Excel sheet of tender events, run and sign-in states, searches, and document downloads (with SHA-256).
- Include output-folder writability and Drive sync-root availability in the preflight health check.

### Browser readiness

- Add a preflight check for Chrome availability, portal reachability, profile lock, and database writability.
- Show actionable recovery text before a job starts.
- Prevent duplicate browser sessions and safely reclaim stale automation profiles.

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

- Primary navigation: **Inbox** (tenders needing review), **Tenders** (approved and tracked), **Runs** (automation history and failures), **Calendar** (deadlines), **Settings** (portals, credentials, rules, folders, company profile).
- Move low-frequency commands to the native application menu: output folders and naming, import/export settings, open data or log folder, backup and restore, check for updates, keyboard shortcuts, about and diagnostics.
- Keep frequent actions in the main UI: start discovery, approve/reject, select documents, retry failed stage, open tender folder, view source tender.
- Use human-readable timestamps everywhere instead of raw ISO dates.
- Show a progress timeline per tender and keep portal, job, and tender state visibly distinct.
- Persist filters and saved views; search across title, department, reference, and extracted requirements.
- Write empty states that name the next action.

### Daily workspace

- Replace the plain job list landing screen with a compact Today view.
- Show last successful run, active run, shortlist count, review count, and nearest deadlines.
- Keep job history available as a secondary view rather than the primary destination.
- Provide one dominant action: Start today's scan or Continue review.

### Live job progress

- Show the active orchestration phase, current product category, pages scanned, tenders found, and tenders reviewed.
- Distinguish waiting for login from running automatically.
- Provide safe Cancel and Retry controls at phase boundaries.
- Keep the window useful while Chrome is open instead of showing only a generic running state.

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
2. Tender-centric data model, then the Inbox and approval workflow, duplicate/corrigendum detection, and new navigation.
3. OCR (English + Tamil), then source-linked eligibility extraction and review.
4. Independent GeM adapter: public discovery, login checkpoint, human CAPTCHA/OTP, session-expiry recovery that keeps the shortlist.
5. Company profile, bid/no-bid analysis, calendar, and readiness/outcome tracking.
6. Collaboration only if the single-operator decision changes.

## Explicitly avoid for now

- Fully autonomous bidding or submission.
- Hidden AI scoring with no evidence.
- Uploading every discovered tender before relevance review.
- Treating visual similarity as proof that a beta portal is fully compatible; every portal must pass the certification flow.
- Complex dashboards before the review and acquisition workflows are complete.
