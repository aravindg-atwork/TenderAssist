---
name: TenderAssist
description: Every tender is a consignment, tracked Speed Post style from Found to On Drive.
colors:
  ground: "#d6eaf5"
  ground-2: "#c4dfee"
  sheet: "#ffffff"
  sheet-2: "#f1f8fc"
  line: "#cfe0ec"
  line-strong: "#a9c4d8"
  ink: "#0d1b33"
  ink-2: "#364865"
  ink-3: "#4b5d79"
  navy: "#0b2250"
  navy-2: "#143372"
  rail-ink: "#c5d3ee"
  rail-muted: "#8ea3c9"
  blue: "#1f63d1"
  blue-soft: "#d4eaf7"
  blue-ink: "#15458f"
  red: "#d42a22"
  red-hover: "#b6201a"
  red-soft: "#fde8e6"
  red-ink: "#9f1b15"
  amber: "#f0b429"
  amber-soft: "#fff3d4"
  amber-ink: "#7d5200"
  green: "#0f8a5f"
  green-soft: "#ddf4e9"
  green-ink: "#0a6343"
  slate: "#5d6b84"
  slate-soft: "#e9edf3"
typography:
  display:
    fontFamily: "Figtree Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 750
    lineHeight: 1.12
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Figtree Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 750
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Figtree Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 750
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Figtree Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.55
    fontFeature: "tnum"
  numeral:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.05
  label:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "0.05em"
rounded:
  sm: "8px"
  control: "10px"
  inset: "12px"
  tile: "14px"
  sheet: "16px"
  sheet-lg: "20px"
  pill: "999px"
spacing:
  tight: "6px"
  gap: "10px"
  stack: "14px"
  section: "20px"
  sheet-pad: "28px"
  page-x: "40px"
components:
  button-act:
    backgroundColor: "{colors.red}"
    textColor: "{colors.sheet}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  button-act-hover:
    backgroundColor: "{colors.red-hover}"
  button-act-xl:
    backgroundColor: "{colors.red}"
    textColor: "{colors.sheet}"
    rounded: "{rounded.inset}"
    padding: "0 28px"
    height: "54px"
  button-primary:
    backgroundColor: "{colors.navy}"
    textColor: "{colors.sheet}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.navy-2}"
  button-quietline:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "44px"
  button-quietline-hover:
    backgroundColor: "{colors.slate-soft}"
    textColor: "{colors.ink}"
  button-line:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  button-line-hover:
    backgroundColor: "{colors.sheet-2}"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.blue-ink}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "36px"
  button-text-hover:
    backgroundColor: "{colors.blue-soft}"
  input:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "44px"
  tag:
    backgroundColor: "{colors.slate-soft}"
    textColor: "{colors.slate}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "3px 11px"
  tag-keep:
    backgroundColor: "{colors.green-soft}"
    textColor: "{colors.green-ink}"
  tag-look:
    backgroundColor: "{colors.amber-soft}"
    textColor: "{colors.amber-ink}"
  tag-later:
    backgroundColor: "{colors.blue-soft}"
    textColor: "{colors.blue-ink}"
  consignment:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet-lg}"
    padding: "26px 32px 28px"
  rail:
    backgroundColor: "{colors.navy}"
    textColor: "{colors.rail-muted}"
    width: "88px"
  rail-tab-active:
    backgroundColor: "{colors.navy-2}"
    textColor: "{colors.sheet}"
    rounded: "{rounded.inset}"
  segmented-option-selected:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "38px"
---

# Design System: TenderAssist

## Overview

**Creative North Star: "The Speed Post Counter"**

TenderAssist is an India Post counter in office daylight. Inland-letter blue tints the whole ground, a deep navy rail holds the app on the left, and white sheets carry the work. Each tender is a consignment with a number stamp, a tracking strip, and a dated postmark; the operator's job is to take the one next step the counter puts in front of them, not to scan a dashboard.

Density is calm and single-minded: one large sheet per screen where a decision is due, lists of consignments where review is due, and settings shown one section at a time. Two voices carry the type. Figtree speaks the UI and the tender titles; Barlow Condensed is the postal voice for numerals, stamps, labels in postal capitals, and the postmark. Colour is semantic before it is decorative: postbox red is the act, amber needs a look, green is done, blue is in transit.

The world rejects the grey dashboard of panes, cards, and badges. It is light only; there is no dark theme.

**Key Characteristics:**
- Inland-letter blue ground, navy rail, white sheets with blue-grey hairlines.
- Postbox red reserved for the act. The postmark takes the decision's colour: green Approved, slate Rejected, blue Later.
- Barlow Condensed numerals and postal-capital labels against Figtree UI text.
- A five-stop tracking strip on every tender and every run.
- One authored motion: the consignment arrives and the postmark stamps it.

## Colors

A cool postal palette: blue paper and navy ink, with four signal colours that each mean one thing.

### Primary
- **Postbox Red** (red): the act. The Approve, Start, Search these dates, continue-a-stopped-run, and confirm-rule-rejects buttons; the round brand mark (and app icon); and the "your turn" marker (the current tracking stop, the waiting count on the rail and the Decide switch, the run sheet that needs the operator). Hover deepens to Pillar-Box Shadow (red-hover). Red Ink (red-ink) on Red Wash (red-soft) carries urgency and failure: closing soon, a failed download, a problem status.

### Secondary
- **Speed Post Navy** (navy): the rail, the navy main button for anything that is not the act (save, update, go somewhere), the summary band at the foot of the Find sheet, portal marks and run date blocks, and the current page in the pager. Rail Lift (navy-2) is the active rail tab and the navy button hover.
- **Transit Blue** (blue): in transit and selected. Reached tracking stops and their connecting line, the progress bar, selected tiles and presets, the focus ring, the active file tab underline. Blue Ink (blue-ink) is link and text-button colour; Blue Wash (blue-soft) is the hover and "later" tint.

### Tertiary
- **Speed Post Amber** (amber): needs a look. Unsure tracking stops, "this week" deadlines, waiting notes. Amber Ink (amber-ink) on Amber Wash (amber-soft) for text.
- **Delivered Green** (green): done and kept. Kept stops, saved files, a live run, "calm" deadlines. Green Ink (green-ink) on Green Wash (green-soft) for text.

### Neutral
- **Inland Letter Blue** (ground): the app background and the drawer panel. Deeper Letter (ground-2) is the well behind segmented switches, shelves, progress tracks, and the portal surface.
- **Sheet White** (sheet): every working surface. Sheet Tint (sheet-2) is the inset panel inside a sheet (the Why line, document rows, table headers, pager band).
- **Hairline** (line) and **Firm Hairline** (line-strong): dividers inside sheets, and the border of fields, outline buttons, and unreached tracking dots.
- **Ink** (ink), **Ink Two** (ink-2), **Ink Three** (ink-3): headings and values, body and secondary text, labels and hints.
- **Rail Ink** (rail-ink) and **Rail Muted** (rail-muted): text on navy, current and resting.
- **Franked Slate** (slate) on **Slate Wash** (slate-soft): rejected, stopped, and plain states; the quiet-outline hover.

### Named Rules
**The Postbox Rule.** A red-filled button is the act the operator takes: Approve (and Keep when a run asks), Start, Search these dates, continue a stopped run, confirm rule rejects. Every other main button is navy.

**The One Meaning Rule.** Amber means needs a look, green means done or kept, blue means in transit or selected, slate means set aside. Never use a signal colour for decoration.

## Typography

**Display Font:** Figtree Variable (with Segoe UI, system-ui)
**Body Font:** Figtree Variable (with Segoe UI, system-ui)
**Label/Numeral Font:** Barlow Condensed 500/600/700 (with Arial Narrow)

**Character:** Figtree is the clerk: friendly, legible, heavy at headline weights (750). Barlow Condensed is the franking machine: tall, narrow numerals and spaced capitals that read like a stamp. Both are self-hosted; body numbers are tabular.

### Hierarchy
- **Display** (750, 2.5rem, 1.12, -0.03em): the consignment title on Decide, max 26ch. Drops to 2rem below 1040px wide.
- **Headline** (750, 1.875rem, -0.025em): page titles (Today, Tenders, Runs, Settings).
- **Title** (750, 1.5rem, 1.25): the full-tender cover title, the run's "now" sheet, rule-check and all-done headings. Section headings inside sheets step down to 1.25 to 1.375rem.
- **Body** (400, 0.9375rem, 1.55): all UI text. Prose blocks cap at 60 to 75ch; hints are 0.875rem in ink-3.
- **Numeral** (Barlow Condensed 600, 1.875rem, 1.05): the three facts on a consignment. Tally figures run to 2.25rem; card values 1.5rem; ledger numbers 1.125rem.
- **Label** (Barlow Condensed 600, 0.8125rem, 0.05 to 0.07em, uppercase): tags, statuses, tracking stop names, fact and table column labels, the Why marker.

### Named Rules
**The Consignment Rule.** The consignment title is the largest type on any screen. Numerals and the postmark may be bold, never bigger.

**The Postal Voice Rule.** Barlow Condensed is for numbers, stamps, and short labels in postal capitals. Sentences, buttons, and titles stay in Figtree.

**The No Kicker Rule.** No eyebrow or kicker labels above headings. A postal-capital label names a value or a state beside it; it never introduces a heading.

## Layout

An 88px navy rail on the left, then a work column. A frameless 44px top bar (sticky, ground at 90% with blur) carries the next-step line ("Next: decide 4 tenders") and leaves 152px on the right for the window buttons. Pages centre in a 1040px column with 40px side padding (24px below 1040px wide) and 20 to 22px between blocks.

Decide shows one consignment sheet at a time, with the count ("1 of 4"), a progress bar, and See all above it, and keyboard hints below. Find is a single guided sheet of questions in order beside a 340px side column that stacks below 1200px. Settings is a 200px section list beside one section sheet. A live run splits into a guide column and the portal view with a draggable divider. Below 800px of height the consignment tightens so Approve stays on screen on a 1366x768 laptop. The app's minimum window is 900px.

**The One Next Step Rule.** Every screen leads with the single next thing to do. The top bar always says it.

## Elevation & Depth

Sheets lift off the blue ground with soft navy-tinted shadows; everything inside a sheet is flat, separated by hairlines and Sheet Tint insets. Three steps, all with negative spread so they read as paper resting on paper.

### Shadow Vocabulary
- **Rest** (`0 1px 2px rgba(13,34,80,.06), 0 1px 1px rgba(13,34,80,.04)`): list sheets, tables, chips, fields, outline buttons, the selected shelf.
- **Raised** (`0 6px 16px -6px rgba(13,34,80,.16), 0 2px 4px -2px rgba(13,34,80,.06)`): the full tender file, settings sections, the selected Decide/Find option, tile and card hover.
- **Lifted** (`0 24px 48px -20px rgba(13,34,80,.32), 0 6px 12px -6px rgba(13,34,80,.1)`): the consignment and the Find guide, the one sheet the screen is about.

### Named Rules
**The Border-and-Tint Rule.** Selected is a blue border plus a pale tint (tiles, choices) or a white sheet in a well (switches, shelves). Never a zero-offset glow halo. The only zero-offset ring is the keyboard focus ring.

**The No Stripe Rule.** No coloured side stripes on cards, rows, or alerts. Urgency tints the whole footer band of a tender card; state lives in the tracking strip and the pill.

## Shapes

Rounded, soft-cornered paper. Controls (buttons, fields, selects, list rows, segmented options) are 10px; small buttons and tile marks 8px. Insets inside a sheet (the Why line, documents, notes, chip and category wells, the rail tabs) are 12px; tiles and choices 14px. Sheets are 16px for lists and tables, 20px for the hero sheets (consignment, guide, file, settings section, run "now"). Tags, statuses, chips, presets, counts, and progress bars are full pills. Tracking dots and the postmark are circles. The consignment number stamp is a deliberately square 6px box with a solid ink border and an inverted site code, like a printed label.

**The Radius Rule.** Controls 10px, sheets 16 to 20px, tags and chips are pills.

## Components

### Buttons
Confident and few. 650 weight, 40px tall by default, 10px corners, a 1px press-down on active.
- **Shape:** 10px (8px at small 32px height; 12px at the 54px extra-large size used for Approve).
- **Act (red):** Postbox Red with white text, a faint inner top highlight and a soft red drop shadow below; hover to red-hover. Min 180px wide on the consignment.
- **Primary (navy):** Speed Post Navy with white text, same construction; hover to navy-2.
- **Quiet outline:** transparent with a Firm Hairline border and ink-2 text, 44px tall, no shadow; hover fills Slate Wash. This is Reject beside the big red Approve.
- **Line:** white with Firm Hairline border and Rest shadow, for ordinary secondary actions.
- **Text:** Blue Ink on nothing, 36px; hover fills Blue Wash. "Decide later", "Read the full tender", "See all", "Close".
- **Focus:** a 2.5px Transit Blue outline offset 2px.
- **Disabled:** 45% opacity.

### Tags and Chips
- **Style:** full pills in the Label voice (Barlow Condensed 600, uppercase, spaced) on a wash with the matching ink: green kept, amber needs a look, slate rejected or stopped, blue later or working, red problem.
- **Chips** (keywords, categories) stay in Figtree 600 on white with the Rest shadow and a round remove button that turns red-soft on hover.
- **Counts:** small pills; red when the count is the operator's turn, Deeper Letter otherwise.

### Cards / Containers
- **Corner Style:** 16px for list sheets, 20px for hero sheets.
- **Background:** Sheet White on the Inland Letter ground; Sheet Tint for insets and table headers.
- **Shadow Strategy:** Rest, Raised, or Lifted by importance (see Elevation & Depth).
- **Border:** none on sheets; hairlines divide inside.
- **Internal Padding:** 18 to 20px on list sheets, 24 to 32px on hero sheets.
- **Tender card:** a navy portal mark, title and department, a condensed value, and a pill deadline clock across the top; a tinted footer band (amber this week, red-pale closing soon) holds the compact tracking strip and the tender ID.

### Inputs / Fields
- **Style:** 44px, white, 1px Firm Hairline border, 10px corners, Rest shadow; label above in 0.8125rem 650 ink-2.
- **Hover:** border darkens to ink-3.
- **Focus:** border turns Transit Blue with a 4px blue ring at 18%.
- **Disabled:** Sheet Tint fill, ink-3 text.

### Navigation
- **Rail:** 88px navy, the round red brand postmark at the top, stacked icon-over-label tabs (Today, Tenders, Runs, Settings) in 0.75rem 600 Rail Muted, More pinned at the bottom. Hover lightens to white on a 6% white wash; the current tab is white on navy-2 with 12px corners. A green panel shows when a search is running.
- **Segmented switch:** a Deeper Letter well (14px, inset shadow) with 38px options; selected is a white sheet with the Raised shadow. Used for Decide / Find tenders and the Tenders shelves.
- **Settings:** a sticky section list; the current section is a white sheet with the Rest shadow.

### Tracking Strip (signature)
Five stops in a grid: Found, Read, Kept (or Unsure, Rejected), You decide (then Approved, Later), Files saved. Each stop is a 22px circle (16px compact) with a check, a postal-capital label, and a date in condensed type. Reached stops and the line between them go Transit Blue; kept turns green, unsure amber, rejected slate; the current stop is a hollow circle with a thick red ring and a red label. Every tender (consignment, tender card) and every run row carries one.

### Consignment and Postmark (signature)
The Decide sheet: a number stamp (inverted site code plus tender ID in condensed spaced capitals), the tracking strip, the title at display size, the department, three facts in condensed numerals between hairlines (closing time coloured red, amber, or green by urgency), a Why inset in Sheet Tint, and the act row: red Approve, quiet-outline Reject, text Decide later. On a decision a round date postmark (office name around the ring, date bar, wavy cancel lines, rotated -11deg, multiply blend) stamps the sheet in the decision's colour: red approved, slate rejected, blue later, green done. The sheet's content dims and slides left, and the next consignment arrives from the right.

### Run Rows
A navy date block (day in large condensed numerals, month in small capitals), the run's title and meta, and its own tracking strip. The delete button appears on hover or focus.

## Do's and Don'ts

### Do:
- **Do** put the act in Postbox Red (#d42a22) and every other main button in Speed Post Navy (#0b2250).
- **Do** set Reject as a quiet outline beside the big red Approve, with Decide later as a text button.
- **Do** give every tender and every run a tracking strip.
- **Do** make the consignment title the largest type on screen (2.5rem, 2rem below 1040px).
- **Do** set numerals, stamps, and short state labels in Barlow Condensed; keep sentences and buttons in Figtree.
- **Do** show selection with a blue border and a pale tint, or a white sheet in a well.
- **Do** keep radii to the rule: controls 10px, sheets 16 to 20px, tags and chips pills.
- **Do** use Phosphor icons (regular, 18px default) beside words, never alone as a label.
- **Do** honour reduced motion; every animation collapses to 1ms.

### Don't:
- **Don't** use red fill for anything but the act, the postmark, and the operator's-turn marker.
- **Don't** put zero-offset glow halos on selected or hovered elements.
- **Don't** add coloured side stripes to cards, rows, or alerts.
- **Don't** put eyebrow or kicker labels above headings.
- **Don't** add entrance animations. The consignment arrive and postmark stamp are the one authored motion; overlays may only slide or fade in to open.
- **Don't** use em-dashes in UI copy.
- **Don't** use text glyphs (✓, +, ×) as icons.
- **Don't** build a dashboard of panes, cards, and badges; put one next step on screen.
- **Don't** add a dark theme; the world is office daylight.
