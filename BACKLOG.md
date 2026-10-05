# TenderAssist backlog

Last updated: 5 Oct 2026. Pick up from **Next up**.

## Done (built and tested, not yet committed or packaged)

- **New look:** maroon and cream. Green means kept/approved, red means reject, amber means later, dark brown means needs a look.
- **"Needs a look" tenders show more:**
  - facts from the search list (reference, category, organisation, published date);
  - "What happens next" in plain words;
  - a "Search <date> again" button when the tender never reached My Tenders.
- **Every search session re-checks every undecided favourite in My Tenders, whatever its date.** Tenders the operator already decided are never re-checked.
- **Session report** opens when a search session ends:
  - totals;
  - a line for each date;
  - kept tenders with their files;
  - anything that did not finish;
  - a "Decide them now" button.
- **Collect documents for approved tenders:**
  - **On Today:** a "Collect their documents" button appears once tenders are approved but have no files.
  - **What the run does:** it signs in, opens only those tenders in My Tenders, saves their documents and zip into each tender's existing folder, and copies them to Drive.
  - **How it is labelled:** it shows as "Documents for approved tenders" in Runs and has its own report.
  - **Code:** stored in `jobs.purpose` / `jobs.document_tender_ids_json` (migration `014_document_runs.sql`). The run is `collectApprovedDocuments` and `start-document-run` in `src/electron/main.ts`.
- **Finish reviewer's fixes:**
  - tray as one line per tender;
  - dated notes on the noting sheet;
  - Published date on the cover;
  - plain error wording;
  - no uppercase headings;
  - Runs: delete button only on hover.
- Tests: 350 of 350 pass.

## To test on the real website

- [ ] Approve 1–2 tenders on Today, click **Collect their documents**, sign in, and check:
  - the files land in the tender's folder;
  - the tender moves to "documents collected";
  - the report is right.
- [ ] Run a normal search and check the **session report** appears at the end.
- [ ] Check that "Needs a look" shrinks after a search: every undecided favourite should be re-checked.

## Next up (order agreed)

1. **Categories picked from the website's own list.**
   - Today Settings takes free text. The TN website's "Product Category" dropdown (`#ProductCategory`) has 94 options, and the project only stored our 7.
   - Plan:
     - read the full dropdown list from the website's search page on every search and save it per website;
     - Settings shows a searchable pick list from it, instead of typing;
     - before the first search, show the current 7 and say the full list appears after one search.
   - Code: `src/browser/searchFormController.ts` (`searchCategory` selects `#ProductCategory`), `renderer/src/components/SettingsPage.tsx` ("Categories to search").
2. **Ask the operator during a run when a tender is unsure.**
   - During a run, the run panel asks "Keep or skip?" with the tender's facts and a **2-minute** countdown.
   - With no answer, it skips: the tender goes to "Needs a look", with a note on its sheet that it was skipped because nobody answered.
   - The operator's answer counts as their decision. Keep → its documents are saved on the spot, while the page is still open.
   - Code: `src/orchestration/classificationPhaseRunner.ts` (decision is made in `recordDecision`; documents are saved while the details page is open). It needs a main↔renderer "question" channel, like `pendingMoreDates`.
3. **Suggest intent words from what the operator approves.**
   - Compare words and phrases that keep appearing in approved tenders (title + work description) with ones in rejected tenders.
   - Settings shows "Suggested intent words" with an Add button and the reason (e.g. "in 6 approved, 0 rejected"). Same idea for excluded words, from rejected tenders.
   - Nothing is added automatically.

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
- **Release:** commit, then build installer **0.4.6** (local build only; no push, no release upload).
