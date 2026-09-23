# TenderAssist Product Backlog

This backlog prioritizes reliable daily use over feature volume. The product should remain deterministic and explainable: automation may recommend, but users can always see why a tender was kept, rejected, or sent for review.

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

### Review inbox

- Give `UNCERTAIN` tenders a dedicated queue, separate from the shortlist.
- Allow manual Keep, Reject, and Recheck decisions with an optional reason.
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

- Detect tenders already seen in previous jobs.
- Highlight corrigenda, date extensions, value changes, and document revisions.
- Avoid repeating unchanged tenders in the daily review queue.

## P1 — Document acquisition and reporting

### Download shortlisted tender documents

- Start acquisition only for `KEEP` tenders or manually approved review items.
- Create one job folder and one subfolder per tender using stable, sanitized names.
- Download every available tender document with checksum, source URL, and retrieval timestamp.
- Retry partial downloads and show missing-file status without losing completed files.

### Requirement extraction

- Extract eligibility, EMD, fees, important dates, submission method, scope, deliverables, and contact details.
- Run OCR for scanned PDFs and flag low-confidence extraction.
- Link every extracted fact to its source document and page.
- Produce a tender checklist instead of an untraceable prose summary.

### Drive and Sheets publishing

- Create a configurable Drive root folder, job folder, and tender folders.
- Upload source documents and generated summaries without duplicating unchanged files.
- Create or update a master Sheet with one row per tender.
- Include status, owner, deadline, decision, Drive link, and extraction confidence.
- Record upload failures locally and allow safe retry.

## P1 — Core UI/UX

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

### Deadline intelligence

- Build a calendar of closing dates, pre-bid meetings, clarification deadlines, and opening dates.
- Detect deadline collisions and tenders requiring immediate action.
- Export selected dates to calendar providers after explicit user approval.

### Multi-portal architecture

- Formalize the current shared GePNIC implementation behind search, detail, document, and authentication adapter contracts.
- Keep TN Tenders as the verified reference while certifying the 47 beta portal profiles.
- Add recorded fixtures and selector health tests per portal version.

### Team workflow

- Add owner, reviewer, notes, and decision timestamps.
- Support shortlist approval before documents are published externally.
- Provide a read-only export for stakeholders who do not use the desktop app.

### Analytics

- Report tenders found, shortlist precision, common rejection reasons, category yield, and turnaround time.
- Keep analytics operational and decision-oriented; avoid vanity charts.
- Allow all analytics data to be exported and deleted locally.

## Recommended delivery order

1. Automatic updates, code signing, readiness checks, and job recovery.
2. Review inbox, manual decisions, relevance feedback, and retry failed reviews.
3. Daily workspace, live progress, tender filters, and settings profiles.
4. Document downloads, source-linked extraction, local folder creation.
5. Drive and Sheets publishing with idempotent retry.
6. Scheduling, deadlines, multi-portal adapters, and team workflow.

## Explicitly avoid for now

- Fully autonomous bidding or submission.
- Hidden AI scoring with no evidence.
- Uploading every discovered tender before relevance review.
- Treating visual similarity as proof that a beta portal is fully compatible; every portal must pass the certification flow.
- Complex dashboards before the review and acquisition workflows are complete.
