# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Electron desktop app for Windows; React renderer beside an embedded portal view. Mac builds exist but Windows is the daily target.)

## Users

One operator at a time, per computer: a non-technical tender executive who holds the company's DSC token. They sign in to the government portal (CAPTCHA and DSC PIN by hand), let TenderAssist search and screen, then decide which tenders to pursue. New operators must be able to use it without training. Stakeholders never open the app; they see approved tenders in a shared Google Drive folder.

## Product Purpose

Find relevant government tenders on GePNIC portals (Tamil Nadu verified; other states in beta) for chosen published dates, read each candidate's full details page, keep the ones matching the company's intent, download their documents and zip, and fill an eligibility sheet, so the operator only has to decide. Success: every relevant tender for a date range is found, read, and its files saved, with a clear reason for every tender kept or rejected.

## Positioning

It works inside the operator's own signed-in portal session (credentials, CAPTCHA, and DSC stay human), and does the repetitive part a person would: search by published date, favourite, open each tender in My Tenders, read it, download its files. Decisions stay explainable and the operator's.

## Operating Context

- Daily flow: pick published dates (one or a range) → sign in once (saved login filled, operator types CAPTCHA, DSC signer via OpenWebStart/Java) → each date runs unattended → after the last date, run more dates in the same sign-in or finish → decide in the Inbox → approval copies the tender folder to Drive.
- The portal is slow and sometimes fails; runs must say what is happening and recover without the operator.
- Output lives in a local folder (month/day/tender folders, Documents subfolder, Eligibility.xlsx, a day workbook); approved tenders are copied to a Drive sync folder.
- Settings: portal login, product categories, intent keywords, excluded words, output and Drive folders, automation pacing, text size, portal zoom.

## Capabilities and Constraints

- One run at a time; a run is one published date; a range runs dates one after another in one sign-in.
- CAPTCHA, DSC PIN, and final approval are always manual. Passwords stay in the OS secure store.
- The portal view is a native Electron view placed beside the app UI; the UI must never reload or cover it during a run.
- Readable on small laptop screens and Windows scaling 100–150%, with Standard / Large / Extra large text sizes.
- An AI relevance check (Amazon Nova Lite via the operator's relay) is planned, not yet built.

## Brand Commitments

TenderAssist gets its own simple identity; no company branding. Plain, direct English for a non-technical operator.

## Evidence on Hand

Real data only from the operator's own runs (local SQLite). No customers, testimonials, or metrics to show; do not invent any.

## Product Principles

1. Say what is happening, whether the operator is needed, and what to do next, at every moment of a run.
2. Today's work first: running dates and deciding tenders are the front door; history and settings are a step away.
3. Every decision carries its reason; nothing is kept, rejected, or skipped silently.
4. The portal is unreliable; recover quietly and only ask the operator for what only they can do.
5. A new operator succeeds without training.

## Accessibility & Inclusion

Adjustable text size (three steps) and portal zoom are required; keyboard operation and sufficient contrast for long daily use.
