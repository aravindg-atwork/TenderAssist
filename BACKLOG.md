# TenderAssist backlog

Last updated: 7 Oct 2026. Pick up from **Next up**.

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

## Done after 0.4.8 (7 Oct 2026; built and tested, not yet in an installer)

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
- Tests: 415 of 415 pass.

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

- **Drive copy on this PC.** Google Drive for desktop is not installed, so there is no Drive folder to copy into. The operator's folder is https://drive.google.com/drive/folders/1ExsDTIIiwpEICyz8zGlwasUPgNBwODm2.
  - Once Drive for desktop shows `G:\`, set that folder in Settings → Folders (both websites).
  - Then approve one tender and check that its folder and the day's report sheet appear in Drive.
- Build 0.4.9 after that check.
- **Folder layout today:** `MM-YYYY / DD-MM-YYYY / DD-MM-YYYY_SNO_<short title> / Documents + Eligibility.xlsx`, with `Approved-Tenders-DD-MM-YYYY.xlsx` (the report sheet) in the day folder. Confirm with the operator that this is what they want.

## Later

- **Really understanding a tender (AI).** Today's decision is word matching: an intent word anywhere on the details page means keep. Real reading needs the Amazon Nova Lite relay (13.203.67.167:8787 through an SSH tunnel).
  - Blocked: the AWS security group must allow port 22, and sshd must be running on the VM.
  - We also need the relay's API spec.
  - Plan: add an "AI relay" section in Settings, with the token stored encrypted. The token is already at `%APPDATA%\TenderAssist\relay-token.txt`; never print it.
- **Documents run:** sign in again automatically if the website signs out part-way (search runs already do this).
- **Design wrap-up:**
  - final reviewer pass on the maroon/cream look;
  - write `DESIGN.md` and `.impeccable/design.json`;
  - don't commit `.impeccable/review` screenshots (real data).
- **Release:** next local installer after 0.4.8 (local build only; no push, no release upload).
