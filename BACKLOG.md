# TenderAssist backlog

Last updated: 8 Oct 2026. Pick up from **Next up**.

## Done after 0.5.2 (9 Oct 2026; not yet in an installer)

- **Reports page (daily report)**: per published day: tenders on the website, in your categories, shortlisted, need a look, rejected, approved; per-day and whole-range category tables; Last 7/14/30 days or Choose dates. Click a category to list its tenders (verdict, why, dates); click a tender to open its file and decide it there.
  - Tamil Nadu "on the website": public "Tenders by Organisation" lists (`src/portal/publicTenderCounts.ts`), read after runs when older than 6 h and with Refresh website totals (about 2 minutes, 64 pages). Open tenders only: older days come out lower. Real read 9 Oct: 427 (9 Oct), 466, 419, 346, 329…
  - GeM: every bid that started that day (from the day search), with GeM's own categories; "in your categories" = bids passing the category check (G2).
  - Code: `src/review/dailyReport.ts` (tested), `daily_portal_counts` table (migration 016), `ReportsPage.tsx`.
- **Typing like a person** (Settings → Speed → Typing): login ID and password typed one key at a time (70–220 ms, sometimes longer); separate from the click pause. "All at once" keeps the old way.
- **CAPTCHA/DSC call**: taskbar flash and Windows alert sound once when the CAPTCHA or DSC signer step needs the operator. Automatic CAPTCHA solving was asked for and declined: it would get round the website's human check.
- **Settings auto-save** about a second after a change (skipped while something required is missing; a password being typed is saved only by Next or Save changes), and **Next: <section> →** under each section.

## Licence keys (10 Oct 2026; built, not yet live)

Decided with the owner (10 Oct): a key belongs to **one Google account** and a number of **PCs set per key** (price per PC); after its last day come **grace days** (default 3, per key) with a warning, then a **full lock**; **3 days offline**; the admin "website" is a **Google Sheet + Apps Script** (also the key server). Setup and daily use: `docs/licence-setup.md`.

- Sheet + server: `licence-server/` (Code.gs, NewKey.html, appsscript.json). Licences menu: New key… (trial/paid, PCs, grace, ready-to-send message), add/take days, suspend, reset PCs, free the Google account; live Days left / PCs in use; red/amber rows; morning email of keys ending. Answers signed RSA-SHA256; the private key is in `licence-server/secret/` (git-ignored) and the script's properties only.
- App: `src/licence/` (rules, server client, manager; tested in `tests/licence/`). Activation = key + Google sign-in (`signInForIdToken`, `openid email`). Checks at start and every 6 h. `claimRun()` refuses every run when the key does not allow work. Screens: `renderer/src/components/Licence.tsx` (gate before the app, warning strip, Settings → Licence).
- Installer: key page after the install folder (`build/installer.nsh` + `build/check-key.ps1`); refuses an unknown/ended key; saves it to `%APPDATA%\TenderAssist\licence-key.txt` for the first start. Skipped when the PC already has a licence and for silent updates.
- **To go live:** make the sheet, deploy the web app, put its URL in `src/licence/licenceServer.ts` and `build/installer.nsh` (`npm run dist:*` refuses to build without it), make an In-production Google client for sign-in (`google-licence-client.json`; the Drive client is in Testing, so only test users could sign in).
- **Checked 10 Oct** (Code.gs run unchanged in a local stand-in for Google, with Apps Script's redirect): key making, peek, activate, wrong account, PC limit, suspend, reset PCs, bad requests; the installer's check-key.ps1 (good, wrong, suspended, offline, quotes in the key); the installer compiles and its key page shows and refuses an empty key; the built app activated → shortened date (strip) → suspended (lock, runs refused) → renewed (Check again unlocks) → PCs reset (asks to activate again).
- **Not yet seen running:** the script inside Google itself (menu, dialog, daily email), and a real Google sign-in.
- Later: payment provider; self-serve renewal.

## Done in 0.5.2 (9 Oct 2026; local installer built)

- **Reading inside documents** (`src/documents/`): PDFs by their own text, scanned pages and images by Windows' built-in OCR (Windows.Media.Ocr + Windows.Data.Pdf through PowerShell; nothing to install). Read after documents are saved (runs and "Collect documents"), then requirements are found from page + documents. Saved documents are caught up in the background 20 s after start-up.
  - On the real data: all 160 saved PDFs read: 132 own text, 22 by OCR, 6 mixed; 112 scanned pages. Excel/Word (price bids, BOQs) are not read yet.
  - Tender → Documents shows how each file was read, the operator's words in it, and a preview (GeM's Hindi dropped from previews). Summary shows "Found in the page and its documents", with junk values filtered (`cleanRequirement`).
  - Windows' components refuse paths over 260 characters; long GeM tender folders reach 286. OCR reads such files from a short temp copy. **Open:** the folder names themselves are long enough to trouble Explorer/Drive; shorten tender folder names.
- **Live run panel**: "This search" with counts and "Review what was found" (every tender, verdict and why, Approve / Approve anyway / Reject), then "Collect documents now" in the same sign-in (`collect-documents-in-run`). The finished-dates message points there instead of to Runs.
- **Check for changes, visible**: the run panel shows how many tenders are followed (or says none are), and "Checked <time>: <result>" after each check. A check run has its own report and run view (per tender: changed or not, what changed).
- **Excluded-word suggestions**: GeM form wording ("Custom Bid for Services", "; Yes; Buyer Premises") ignored; only phrases suggested.

## Fixed after 0.5.0 (9 Oct 2026; in 0.5.1)

- **Tamil Nadu dropped "Information Technology" from its Product Category list** (some days it is there, some not). The search waited 30s per try on a missing option and looked like a slow portal (3 tries). Now the category is checked against the website's list first: missing → skipped at once with "not in the website's Product Category list today"; case/spacing differences are matched (`findCategoryLabel`, `CategoryNotOnPortalError`).
- **Google Drive gets only approved tenders** (user request). The direct upload used to send every tender folder a run saved, including ones waiting for a decision. Now, like the Drive for desktop copy, only approved tenders go (`isApprovedTender` in `main.ts`). Approving uploads the tender; rejecting never does. Report sheets still upload after every run. Not covered by a test (main.ts has none).
- **Extended closing dates and corrigenda** (agreed with the operator, 9 Oct). Core in `src/review/watchedTenders.ts` (tested); wiring in `main.ts` (`checkWatchedTenders`, `checkWatchedGemBids`, `runChangeCheck`).
  - Tamil Nadu tender pages are now read for "Bid Submission End Date" (the current closing date; before this, TN tenders had none, so they never expired) and the "Latest Corrigendum List" (types seen: Date, Other).
  - At start-up, pages saved earlier are caught up quietly: on the real data, 66 of 69 TN tenders got their closing date, 8 corrigenda were recorded, and 18 past their date became Expired.
  - Followed tenders: approved, decide later, and waiting (not rule- or hand-rejected), until 3 days after closing (30 days after found when the date is unknown).
  - Checked: (1) after the last date of every Tamil Nadu search, still signed in (pages read in the last 20 h skipped, at most 40, soonest closing first); (2) "Check for changes" in the run panel's "What next?" (same sign-in); (3) "Check for changes" on Today (signs in first); (4) GeM: at the end of every GeM run and from Today, no sign-in: each bid found again by its start day in GeM's list (current end date, cancelled). A check the operator asks for re-reads everything.
  - On a change: a later closing date is logged; an expired tender extended into the future opens again as it was (approved stays approved); a decided tender returns under "Changed since you decided"; approved tenders' new corrigendum files go to "Corrigendum <n>" in the tender's documents folder, then the sheet and Drive are refreshed. Report sheet has a "Corrigenda" column.
  - Runs list it as "Changes in followed tenders"; its report is "Check for changes".
  - Live-checked: GeM check (twice) on the real data copy. **Not yet live:** the Tamil Nadu re-read (needs a sign-in) and the corrigendum "View" page download (its page was never captured; failures leave a note on the tender). GeM corrigendum documents are not read.
  - Fixed on the way: a run that ended before its start call returned left the app showing "running" forever (`App.tsx`, `endedJobs`).
- **False "The website is having trouble right now" on Today** (operator report, 9 Oct). Not the website and not the address: Node's `fetch` sends `Accept-Language: *`, and every GePNIC site answers that with HTTP 500 (checked: Tamil Nadu, CPPP, Kerala, West Bengal, Uttarakhand: old 500, new 200). The website check now asks like a browser (`PORTAL_CHECK_HEADERS` in `src/system/preflight.ts`, test in `tests/system/preflight.test.ts`).
- **Website categories that change** (agreed with the operator, 9 Oct). Logic in `src/config/categoryHealth.ts` (tested); picker in `renderer/src/components/CategoryReplacement.tsx`.
  - Every read of a website's list is remembered per category (first and last seen) in `portal_categories:<id>`. Lists saved before count as the first sighting.
  - A chosen category the website dropped is never removed by itself. Runs skip it (the end message says so) and search it again if it comes back.
  - Today → Find warns before Start ("… is not on Tamil Nadu's category list, read <time>"), with **Choose replacements** and **Skip for now**. Skip hides the warning until another category goes missing; Settings still shows it.
  - The picker allows several choices. Suggestions: first, categories where tenders the operator wanted (approved, or kept) were listed, including the category on a tender's own page; then categories new since it went (a likely rename); then similar names. It also says what the dropped category brought before.
  - "Stop searching it" is off by default and on after 14 days gone. In Settings, a chip says "Last on the website's list <time>" or "Gone two weeks or more. Remove it?", and has a Replace link.
  - Settings shows categories new on the website since the operator last looked (add with one click, "Seen them").
  - Tamil Nadu's list is read only during a search (after sign-in), so Today's warning uses the last run's list. GeM's list is public and read every two weeks.
  - Not yet seen in the running app.
- **Decide: rule-rejected tenders had only "Move back to review"** (user feedback). They now have Reject, Approve instead, Decide later and Move back to review; A/R/D keys work on them too. The walkthrough has Previous / Next buttons beside See all.

## Done in 0.5.0 (8 Oct 2026; local installer built, not yet installed on a clean PC)

- **Installer: Terms and Conditions page** (`build/license.txt`, an "I Agree" page before anything installs). Draft wording: needs the company's own review (name, governing law city).
- **Installer sets up the DSC signer** (`build/installer.nsh` runs `build/prereqs.ps1` after the app is copied):
  - Looks for OpenWebStart (`.jnlp` association or `javaws.exe`) and Java 8+ (registry, Temurin keys, `JAVA_HOME`, `PATH`).
  - Downloads only what is missing, with fixed versions and SHA-256 checks: Eclipse Temurin 8u504 JRE MSI and OpenWebStart 1.14.0. Both hashes were checked on 8 Oct.
  - Installs silently with one Windows permission prompt. OpenWebStart is installed for all users, opens `.jnlp` files, and searches local JVMs.
  - Silent updates skip this step. If it fails, the installer says so and the app still offers the OpenWebStart download.
  - `-DryRun` detects and downloads only (tested here: found the per-user OpenWebStart; Temurin downloaded and verified).
  - To bump versions: change the URL and hash in `prereqs.ps1` (Adoptium API / GitHub release `digest`).
- **Redesign from scratch: "Speed Post"** (the operator approved it on 8 Oct). Rules: `DESIGN.md` + `.impeccable/design.json`; direction contract in `.impeccable/surfaces/renderer-src.md`.
  - India Post world:
    - inland-letter blue ground, navy rail, white sheets;
    - postbox red only for the act (Approve, Start) and the operator's turn;
    - Barlow Condensed numerals and labels, Figtree for the UI text, Phosphor icons.
  - Signature: a tracking strip on every tender and run (Found, Read, Kept, You decide, Files saved), and a dated SVG postmark that stamps each decision.
  - Today is a walkthrough with a Decide | Find switch:
    - Decide: one tender at a time (A/R/D/J/K), See all drawer, rule rejects cleared in one step.
    - Find: website tiles, quick dates, Start.
  - Tenders are cards with their strip and days left, with search, sort and pages.
  - Runs are rows with a strip each, with filters, search and pages.
  - Settings shows one section at a time.
  - Frameless window: the app draws its own top bar with the next step; the old menu moved to More in the rail.
  - GeM category names show as tidy single lines.
  - Reviewed by Impeccable's finish reviewer over two fix rounds, then documented. The detector is clean.
  - Not yet seen by a reviewer: the run panel beside a live portal session.
- **Run panel never looks stuck** (user feedback: the empty space below the steps felt frozen). A tracking history fills it:
  - each step the run reports, timed and newest first, with Kept / Unsure / Rejected labels and an "N of M" progress bar;
  - a ticking "last update Ns ago"; after 45s of silence it says the portal can be slow and nothing is lost.
  - Tamil Nadu reports every tender read ("Read 3 of 7: <title>. Kept.", `classificationPhaseRunner.ts`); GeM reports every bid read and every missing bid document (`gemRunner.ts`). "Reading bid N" and its result share one line, and GeM's page-by-page count updates its own line.
- **Decisions made after a run reach the sheet and Drive.**
  - Approving or rejecting on Today or Tenders, any day later, rewrites that day's report sheet: the tender is added or marked, with "Approved by you" / "Rejected by you" as the review reason.
  - The rewrite runs in the background (`refreshDaySheets` in `main.ts`), then the tender folder and the sheet go to Drive: the Drive for desktop copy and, when signed in, the Google Drive upload.
  - A tender approved without documents still needs "Collect their documents"; that run uploads them as before.
- **Month folders named October-2026** (were 10-2026).
  - New `{MONTH}` name in the folder templates; the default month folder is `{MONTH}-{YYYY}`.
  - Settings still on the old default move over by themselves; a month template typed by the operator is kept.
  - Runs saved before keep their own folders, so old tenders are still found. Day and tender folders stay numeric (08-10-2026).
- **The Approve postmark is green** (was red); Rejected is slate, Later blue.
- **New app icon (TA, Speed Post)**: a postbox-red tile with a date-postmark ring and TA in Barlow Condensed. 16 and 24 px drop the ring and keep bold TA.
  - Generated by `npx electron build/icon-source/make-icon.cjs` into `build/icon.ico` (16-256) and `build/icon.png` (512).
  - Used by the app, the installer and the uninstaller.
  - The desktop shortcut from the 0.4.12 install showed the Electron default, because that build had no icon.
- **Portal locked while a run drives it** (user feedback: stray clicks mid-run made runs fail).
  - A see-through shield view sits over the portal; the operator's clicks land on it. TenderAssist's clicks go to the page over CDP, so they pass.
  - Proven in Electron: a real OS click was blocked with the shield (0) and counted without it (1); a CDP click passed with it (1).
  - Locked while searching, reading or saving files. Open for sign-in, CAPTCHA, DSC, keep-or-skip questions, a signed-out portal, the choice of more dates, and after the run.
  - Rule in `src/electron/portalLock.ts` (6 tests); shield in `embeddedPortalHost.ts`.
  - The portal bar says "Clicks paused while TenderAssist works" with a two-step "Let me use the portal"; then "You have control" with "Hand back".
  - The portal's Back and Reload buttons are disabled while locked. Control resets when the run ends.
  - The shield page cannot be picked as the portal page: automation finds the portal by its URL.
- **Switch website after the last date**: "What next?" in the run panel has a Website choice. Picking another website signs out of this one (report saved) and starts the other (`switch-portal-run`). The dates are checked first, so a bad range leaves the sign-in waiting as before.
- **Startup**: the window appears once painted, on the app background (no white flash).
- **Fixed: a development copy (`TENDERASSIST_USER_DATA`) opened the installed app's database.** The database and DSC downloads now follow the override as well.
- Tests: 434 of 434 pass (one real-Chrome auth test, authJobRunner, is occasionally flaky; it passes on rerun).

## Done in 0.4.6 (6 Oct 2026; built and unit-tested, not yet tried on the real website)

- **Categories picked from the website's own list.**
  - Each search reads the website's Product Category dropdown and saves it per website (`portal_categories:<portal>` in `app_settings`).
  - Settings → "Categories to search" is a searchable pick list from it. Before the first search it shows the 7 starting categories and says the full list appears after one search; typing a name is only allowed then.
  - A chosen category that is not on the website's list is shown in red.
- **The run asks "Keep or skip?" when a tender is unsure.**
  - "Unsure" means: no check could decide it, **or** it would be kept only because an intent word appears in its details while its title has none. (With word matching alone the first case is rare, so the second is what will usually trigger the question.)
  - The run panel shows the tender's facts and a 2-minute countdown. Keep = approved, documents saved while the page is open. Skip = rejected.
  - No answer: it goes to "Needs a look" with a dated TenderAssist note on its sheet saying nobody answered. Its documents can be fetched later with "Collect their documents" after approving.
  - Code: `src/orchestration/runQuestion.ts`, `askOperator` in `classificationPhaseRunner.ts`, `askOperatorDuringRun` + `answer-run-question` in `main.ts`, `QuestionCard` in `RunPanel.tsx`.
- **Suggested intent and excluded words** in Settings, learnt from approved vs rejected tenders (title + Work Description; excluded words from titles only).
  - A phrase needs 3+ tenders on its side and at most one in four on the other; words already in the lists are not suggested. Nothing is added until the operator selects Add and saves.
  - Code: `src/review/wordSuggestions.ts`.
- Tests: 369 of 369 pass.

## Done in 0.4.12 (7 Oct 2026; local installer built)

- **Fixed: Drive folders were uploaded as one long name** ("10-2026\07-10-2026\07-10-2026_13_…") instead of nested folders.
  - Cause: the path split lost a backslash, so it split only on "/" and Windows paths use "\".
  - Now `driveFolderPath` splits both kinds of slash, and a test checks the nested layout on a stand-in Drive.
  - The wrongly named folders from 0.4.11 sit at the top of "Claude TN Tenders- 2026-27" and need deleting by hand.

## Done in 0.4.11 (7 Oct 2026; local installer built)

- **Drive keeps the same files as this computer.** After every search, each saved tender's folder (documents, eligibility sheet) and the day's report sheet are uploaded; approval no longer matters.
  - Uploads also run after "Collect their documents" and when a report sheet is rewritten.
  - **"Upload everything saved so far"** in Settings sends what was saved before (earlier days included); unchanged files are skipped.
  - Results: a note on each tender's history, a Windows notification when an upload finishes, a message naming what failed, and the last upload shown in Settings.
  - Why nothing reached Drive in 0.4.10: uploads only happened on approval, and nothing had been approved since signing in.
- **Google sign-in is built into the app** (0.4.10): the credential is packed from the git-ignored `google-oauth-client.json`. The operator only pastes the folder link and signs in, and a "Copy the sign-in link" fallback covers a browser that will not open it.
- **Report sheet:** the office's 15 columns first, then the earlier columns. Duplicates are left out: Tender ID = TDR Number, Department, Estimated value = Tender Value, EMD, Eligibility = Eligibility Notes, Closing date / Submission deadline = Bid End Date.
- Tests: 422 of 422 pass.

## Done in 0.4.9 (7 Oct 2026; local installer built)

- **Report sheet in the office's 15 columns** (`src/publishing/reportSheet.ts`): SI No, TDR Number, Department, Location, Tender Title (short), Project Nature, Tender Value, Bid Start/End Date, EMD, Pre-bid Meeting Date, Eligibility ("To check"), Eligibility Notes, and links to the tender and to its Documents folder.
  - The folder link is relative, so it works in the Drive copy too.
  - GeM PDFs now give the pre-bid date and a location (buyer state and delivery PIN).
- **Drive copy includes the day's report sheet** (`mirrorReportSheetsToDrive`), tested on disk.
- **Shorter folder names**: no "Custom Bid for Services -", at most 80 characters, to stay within Windows path limits. Folders saved under the old full names are still found.
- **Matching learned from the operator's 341 pursued tenders.** No upload feature: the workbook was for analysis only.
  - Single words count only in titles; phrases count anywhere, with their words together (all websites).
  - Chosen GeM categories other than custom bids are kept on their own.
  - New starting intent phrases, with an "Add N recommended words" button in Settings.
  - A warning for words that are too broad, such as "AMC".
  - Replayed on real data: 304/341 of their tenders recognised (was 134). Today's GeM junk (AMC furnaces, RO plants) is gone, and "Hiring of Agency for IT Projects" is kept.
  - On Tamil Nadu, the recommended words would have matched 50/65 junk tenders under the old rule; the new rule matches 1.
- **Direct Google Drive upload** (see Next up): sign in once in Settings; approved tenders and the day report sheet are uploaded, skipping unchanged files. The sign-in is encrypted and left out of backups.
- Real Drive check (7 Oct): signed in as tenders@bowandbaan.com, folder "Claude TN Tenders- 2026-27" writable, a test file uploaded, and a second upload skipped it as unchanged.
- Tests: 421 of 421 pass.

## Done in 0.4.8 (7 Oct 2026; local installer built)

- **"Keep or skip?" card now shows.** Every run update copied an earlier one whose empty question hid the open one, so runs waited for an answer nobody could see (since 0.4.6, every website). After one unanswered question the run stops asking; the taskbar flashes when a question appears.
- **First-time-user test fixes** (a tester drove a fresh copy through a GeM search): day-first dates, AMC no longer excluded by default, clearer question card with the answers listed, GeM category names follow GeM's rewording, chosen categories shown while searching, truthful Drive/Inbox/count messages, one rupee sign, quiet closing times on rejected tenders, "opened" note for the tender folder.
- A development copy can run beside the installed app: set `TENDERASSIST_USER_DATA` (ignored in the installed app).

## Done in 0.4.7 (7 Oct 2026)

- **GeM (bidplus.gem.gov.in) as a website**, searched with no sign-in.
  - How it works and why: `docs/gem-portal.md`.
  - Code: `src/gem/`, GeM branches in `main.ts` (`runGemDates`, `startGemDocumentRun`), and `saveTenderFiles` in `postProcessingRunner.ts`.
  - **Each website keeps its own categories**, picked from that website's own dropdown. Old settings carry over: the saved categories become Tamil Nadu's, and other GePNIC sites start from them.
  - Settings with GeM selected:
    - GeM's Category list exactly as GeM shows it (search, add, remove); bids matched by GeM's category code;
    - "Also search product bids";
    - no login fields.
  - GeM's starting categories match the office's kinds of work: application development, e-learning, software applications, AMC, websites, mobile apps, plus custom bids.
  - New dependency: `pdfjs-dist` (reads the bid PDFs).
  - Tests: 403 of 403 pass. Live check on 6 Oct 2026 (default words): 1,006 service bids, 197 read, 4 kept, about 8 minutes.

- **"Could not read its details" errors fixed (Tamil Nadu and GeM).**
  - Found from the run data: since 5 Oct every Tamil Nadu failure was one of 4 old favourites that are no longer in My Tenders, carried into every session and "not found" each time. (The earlier one-tender-per-date failures on 5 Oct were the old back-to-My-Tenders bug, already fixed.)
  - My Tenders is now read twice: tenders not found, or whose details did not open, are looked for again from a freshly opened My Tenders.
  - A tender missing both times is marked "no longer in My Tenders" (`NOT_IN_MY_TENDERS`), waits in Needs a look, and is un-favourited on every run so it is never carried again.
  - GeM: about 1 request in 13 gets a random HTTP 500 (on every backend server). Retries now wait 2, 5, 15 and 40 s, and bid PDFs that still fail are tried once more at the end of the run (`GEM_BID_DOCUMENT_FAILED` if not).
  - Plainer wording for each case in the tender file and run details.

## To test on the real website

- [ ] Tamil Nadu: the next run should mark the 4 old tenders (2026_TCMPF_707978_1, 2026_TNPL_708123_1, 2026_TNPL_706473_1, 2026_MAWS_705580_1) "no longer in My Tenders" once, then never show them again.

- [ ] **GeM**:
  - open Settings and pick GeM; the category list should load from GeM;
  - run one date; check the counts in the run panel and the files in the output folder;
  - approve a "Needs a look" tender, then use "Collect their documents".
- [ ] **GeM vs excluded words:** "AMC" and "annual maintenance contract" are in the excluded words, so GeM AMC bids are rejected even though AMC is now a GeM category. Remove them from the excluded words if AMC work is wanted (this also affects the other websites).

- [ ] Run a search, then open Settings: "Categories to search" should list all the website's categories (about 94 on Tamil Nadu).
- [ ] During a run, check the "Keep or skip?" card appears for a tender whose title has no intent word, and that:
  - Keep saves its documents and approves it;
  - Skip rejects it;
  - no answer for 2 minutes leaves it in "Needs a look" with the note on its sheet.
- [ ] After a few approvals/rejections, check the suggested words make sense.
- [ ] Still open from 0.4.5: **Collect their documents**, the session report, and "Needs a look" shrinking after a search.

## Next up

- Install `release/TenderAssist-Setup-0.5.0.exe` on a PC without Java (checks the Terms page, the OpenWebStart + Java setup, the new design) and run one real Tamil Nadu search (the run panel has only been checked in code). Then delete the "10-2026…" folders at the top of the Drive folder, then in Settings → Upload to Google Drive choose "Upload everything saved so far" and check "Claude TN Tenders- 2026-27" in Drive.
  - In Settings → What to look for: add the recommended words and remove "AMC".
- The Google consent screen is External / Testing with tenders@bowandbaan.com as a test user, so Google ends the sign-in every 7 days (Settings then says to sign in again). Making the project Internal under the bowandbaan.com Workspace would remove that.
- **Folder layout:** `October-2026 / DD-MM-YYYY / DD-MM-YYYY_SNO_<short title> / Documents + Eligibility.xlsx` + the day report sheet (month names since 8 Oct). Older days stay under `10-2026`; move them by hand if wanted.

## Later

- **Intent tenders listed in other categories** (operator's thought, 9 Oct: "the tender speaks louder than the category", but do not search every category). Idea: one extra Tamil Nadu search per day using the search form's Work/Item Title field with the intent words and no category, kept to the title screen. Needs a live check of how that field matches.

- **Really understanding a tender (AI).** On hold (8 Oct 2026, owner's call); do not start until asked. Today's decision is word matching: an intent word anywhere on the details page means keep. Real reading needs the Amazon Nova Lite relay (13.203.67.167:8787 through an SSH tunnel).
  - Blocked: the AWS security group must allow port 22, and sshd must be running on the VM.
  - We also need the relay's API spec.
  - Plan: add an "AI relay" section in Settings, with the token stored encrypted. The token is already at `%APPDATA%\TenderAssist\relay-token.txt`; never print it.
- **Documents run:** sign in again automatically if the website signs out part-way (search runs already do this).
- **Release:** 0.5.0 is built locally and installed on this PC. Commit the work; publishing a GitHub release (auto-update for other PCs) is the operator's call.
- **Design bookkeeping:** `impeccable detect` lists small values outside DESIGN.md (selection colour, placeholder grey, 6px radii). Add them to DESIGN.md or fold them into tokens.
- **Do not commit** `.impeccable/review/*.png` from 5 Oct (real tender data); the `speedpost/` screenshots use sample data.
