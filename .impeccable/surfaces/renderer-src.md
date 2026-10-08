---
version: 1
slug: "renderer-src"
primary_target: "renderer/src"
related_targets: []
---

# TenderAssist app (renderer)

Scope: the whole desktop app UI: Today, Tenders, Runs, Run detail, Settings, and the live run workspace beside the embedded portal.
Mode: Operate.
Audience and job: one non-technical tender executive per PC; find tenders for published dates, decide each one, keep its files. Daily, long sessions on a laptop.
Operator feedback (8 Oct 2026): earlier passes read as a generic template, too much text, too much on screen at once, flat, not a walkthrough, too many clicks. Quality bar: Notion/Craft calm with Raycast/Arc boldness. All screens equally.
Constraints: everything the app does today stays (multi-date runs, more dates or another website after the last date, Inbox groups and reasons, Drive copy, retenders, history, all settings, keyboard A/R/D/J/K). No job IDs or internal states shown. One job per screen. Portal view is native and must never be covered or reloaded. Frameless window: the app draws its own 44px top bar under Windows' caption buttons.

## Direction contract

THESIS: Every tender is a consignment TenderAssist tracks for you, Speed Post style: Found → Read → Kept → You decide → On Drive. The app is a walkthrough that puts one next step on screen at a time. It refuses the grey dashboard of panes, cards, and badges.

OWN-WORLD: India Post. Inland-letter blue tints the ground; a deep navy rail; white sheets with blue-grey hairlines; postbox red is reserved for the one action the operator takes (Approve, Start, Your turn); Speed Post amber for needs-a-look; green for done. Type: Barlow Condensed for monumental numerals and labels (postmark voice), Figtree for UI text. The signature move is the tracking strip on every tender and run, plus a round dated postmark that stamps a decision before the next tender slides in.

STORY: The operator opens Today and is told the one next step: decide N tenders, or find today's tenders. They decide them one card at a time and watch each get stamped and filed. Then they start the next search from a three-step guided sheet, and follow the run as a tracking timeline beside the portal.

FIRST VIEWPORT: Navy rail on the left (mark, Today, Tenders, Runs, Settings, More). The top bar shows the next-step line. In the centre is one large tender sheet: the tracking strip across its top, the title at display size, three facts (value, closes in, department) in condensed numerals, and TenderAssist's reason in one line. At the bottom are a red Approve and a quiet Skip, with Later as a link. Top right reads "12 of 24", and a "See all" drawer opens the full queue. Find tenders lives behind a segmented switch: Decide · Find.

FORM: Speed Post (India Post inland letter, Speed Post tracking, date postmark); candidate 4 on my ordered list; seed key ba103c9d.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
