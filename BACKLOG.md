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

Findings from 7 Oct 2026 (operator's "Tenders Interested- 2026 - 2027.xlsx", 341 titles, 54 from GeM; replayed on real runs):

1. **Training from the operator's tender list (GeM relevance).**
   - Today's GeM run kept 4 junk bids, all because the single intent word "AMC" matched any maintenance contract (furnaces, RO plants, IT hardware).
   - It rejected the one bid that was truly theirs, "Hiring of Agency for IT Projects - Milestone basis". That category appears 28 times in their list, but the run also demanded an intent word in the bid document.
   - Plan:
     - (a) Chosen GeM categories other than "Custom Bid For Services" count as the intent by themselves; custom bids still need an intent word.
     - (b) Intent phrases must appear with their words together (`wholePhrase`), in titles too.
     - (c) Single words (website, portal, software, LMS, ERP, …) count only in titles, never in PDF text.
     - (d) A "Learn from your tender list" button in Settings that reads an .xlsx, suggests phrases with how many of the operator's tenders each covers, and flags broad words such as "AMC".
   - Measured on their titles: current words recognise 134/341; the workbook vocabulary with (b)+(c) recognises 304/341, and today's kept bids become relevant ones.
   - The vocabulary is in the session scratch `evalwords2.mjs` (PHRASES / TITLE_WORDS). Rebuild it from the workbook if needed.
2. **Report sheet columns.** The day workbook must have exactly: SI No | TDR Number | Department | Location | Tender Title (short) | Project Nature | Tender Value | Bid Start Date | Bid End Date | EMD | Pre-bid Meeting Date | Eligibility | Eligibility Notes | View Tender Link | Tender Document Link.
   - Today's sheet (`publishJobWorkbook` in `src/publishing/jobPublisher.ts`) has 23 technical columns instead.
   - Project Nature: Application Dev / Website / Software / E-learning / Mobile App / Other, as in their sheet.
   - Pre-bid date: GeM PDF "Pre-Bid Date and Time"; GePNIC "Pre Bid Meeting Date".
3. **Drive copy.** `driveOutputRoot` is empty for both websites, so nothing has ever been copied.
   - Only approved tender folders are copied (`mirrorTenderFolderToDrive`). The day report sheet is never copied: `mirrorJobOutputToDrive` exists but nothing calls it.
   - Plan: ask the operator for their Google Drive for desktop folder, copy the report sheet too, and test the copy end to end.
4. **Folder structure.** Today: `MM-YYYY / DD-MM-YYYY / DD-MM-YYYY_SNO_TITLE / Documents + Eligibility.xlsx` plus `Approved-Tenders-DD-MM-YYYY.xlsx`. Confirm with the operator that this is the structure they want before changing it.

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
