# GeM portal (bidplus.gem.gov.in) — how it works and how TenderAssist can use it

Checked by hand on 7 Oct 2026 with plain HTTP requests, no login.

## 1. What GeM is

GeM (Government e-Marketplace, gem.gov.in) is the central government's buying platform. Since 2017 central ministries, PSUs and most state departments must buy common goods and services through it, so it carries far more tenders than any single NIC (GePNIC) site. On 7 Oct 2026: about 10,800 open **service** bids, about 2,300 with a Tamil Nadu delivery address and 193 raised by Tamil Nadu buyers.

GeM sells two ways:

- **Direct purchase / L1 from the catalogue** (small values). These never become public bids and are not relevant to us.
- **Bids ("BidPlus")**, at bidplus.gem.gov.in. These are what TenderAssist would search.

## 2. The kinds of bid

| Type | Number looks like | Notes |
|---|---|---|
| Bid | `GEM/2026/B/7993226` | Normal tender. Usually two packets: technical, then price. |
| Reverse Auction (RA) | `GEM/2026/R/746323` | Live price auction after a bid's technical stage. Only sellers who qualified in the parent bid can take part. |
| Direct RA | `R` number, `b_bid_type = 5` | Auction with no bid before it. |
| Custom bid | Category starts `Custom Bid for Services - …` | Buyer writes their own scope, not a catalogue service. Most housekeeping, manpower and O&M work comes as custom bids. |
| BOQ bid | | Bill of quantities in an Excel sheet. |
| Rate contract, Global, Limited, Single tender | | Filters on the list page. Limited and single tenders are by invitation; they show up but we usually can't bid on them. |

How a bid runs on GeM:

1. The buyer publishes the bid with a start date and an end date. The **end date** is the submission deadline.
2. Bidders may raise **representations** before the end date. The buyer may issue **corrigenda**, which change the bid, often the end date.
3. Sellers bid. **Bidding needs a GeM seller account** (with an offering in that category for catalogue services), and EMD or an exemption. Looking and downloading need no account.
4. The bid is opened; status moves through *Technical Evaluation → Financial Evaluation → Award*. "Bid to RA" bids go to a reverse auction among qualified sellers first.
5. The contract is placed on GeM and paid through GeM.

So GeM is split in two: search and documents are public, while bidding is the seller's own job inside their account. TenderAssist only needs the public half.

## 3. What is public, with no login (all checked)

### 3.1 The list page: `https://bidplus.gem.gov.in/all-bids`

Filters on the page:

- **Keyword** (one box; it searches the bid number, item or category name, and buyer).
- **Status:** Ongoing, Bid/RA status (evaluated or awarded), Cancelled.
- **Bid type:** All, Product, Service, Bid to RA, Product custom, BOQ, Rate contract, Global, Limited, Single.
- **High value** (estimated value of Rs 2 crore or more).
- **Bid end date** from/to.
- **Sort:** start date or end date, newest or oldest first.

There is **no "published date" filter**. To find one day's new bids, sort by *Bid Start Date: Latest First* and page back until the start date passes that day.

The data comes from a JSON call the page makes:

```
POST https://bidplus.gem.gov.in/all-bids-data
form: payload=<JSON>, csrf_bd_gem_nk=<token>
payload = {"page":2,
           "param":{"searchBid":"housekeeping"},
           "filter":{"bidStatusType":"ongoing_bids","byType":"service","highBidValue":"",
                     "byEndDate":{"from":"","to":""},"sort":"Bid-Start-Date-Latest"}}
```

- The token is printed in the page HTML (`'csrf_bd_gem_nk': '…'`), and it matches the `csrf_gem_cookie` cookie. To get both, open `/all-bids` first with a cookie jar.
- Each page returns **10 bids**. `response.response.numFound` is the total.

### 3.2 Advanced search: `https://bidplus.gem.gov.in/advance-search`

`POST /search-bids` takes the same form shape, but its payload has a `searchType`:

| searchType | Fields | Use for us |
|---|---|---|
| `bidNumber` | `bidNumber`, `category` (category code), `bidEndFrom`, `bidEndTo` | **Search by category.** The dropdown has about 14,000 categories, 425 of them services, with codes such as `services_home_fa85086605_fa43870134`. They are printed in the page HTML. |
| `ministry-search` | `ministry` **or** `buyerState`, then `organization`, `department`, end-date range | Bids from Tamil Nadu buyers, or from one ministry or PSU. |
| `con` | `state_name_con` (required), `city_name_con` | **Bids whose delivery (consignee) address is in a state or city.** This is the "work is in Tamil Nadu" filter. |
| `boq` | `boqtitle_con`, `bidvalue` | BOQ bids by title. |

Advanced search returns only ongoing bids: every result we sampled had a future end date and `b_status = 1`.

Lists that fill the dropdowns (POST, with only the token):

- `/ministry-list-adv`: 76 ministries and 38 buyer states. The list has near-duplicates such as `ANDHRA  PRADESH` with two spaces.
- `/state-list-adv`: delivery states, in capitals (`TAMIL NADU`).
- `/city-list-adv` (`state_name`): cities.
- `/org-list-adv` (`ministry` or `buyer_state`, in capitals): organisations.
- `/dept-list-adv`: departments.
- `/boq-title-adv`: BOQ titles.

### 3.3 One bid record

Fields we would use from each item in `docs[]` (every value comes as a one-item array):

| Field | Meaning |
|---|---|
| `b_id` | Internal id. Used in every link. |
| `b_bid_number` | Shown number, `GEM/2026/B/…` |
| `b_category_name` / `bd_category_name` | Short and long item or service title. The long one is the closest thing to a "work description". |
| `ba_official_details_minName`, `ba_official_details_deptName` | Ministry and department. The ministry is missing for state buyers. |
| `final_start_date_sort`, `final_end_date_sort` | Start and end. **These are Indian time wrongly labelled `Z`.** The page shows them with `timeZone:'UTC'`, so read the wall-clock value as IST and do not convert it. |
| `b_total_quantity` | Quantity. |
| `b_bid_type` | 1 = bid, 2 = RA after a bid, 5 = direct RA. |
| `b_status` | 1 = active, 3 or 5 = cancelled. |
| `b_bid_number_parent`, `b_id_parent` | For an RA, the bid it came from. |
| `is_high_value`, `is_rc_bid`, `ba_is_global_tendering`, `ba_is_single_packet` | Flags. |
| `b_cat_id` | Category code. It matches the advanced-search category dropdown. |

There is **no estimated value, EMD amount or location** in the list record. Those are only in the bid PDF.

### 3.4 Documents

- **Bid document:** `GET https://bidplus.gem.gov.in/showbidDocument/<b_id>` returns the bid as a PDF (about 100 KB). It holds the whole bid: dates, buyer, quantity, turnover and experience requirements, MSE and startup exemptions, EMD and ePBG, evaluation method, consignee addresses, terms, and any buyer-added terms.
  - For an RA the path is `showradocumentPdf/<id>`; for a direct RA it is `showdirectradocumentPdf/<id>`.
- **The buyer's attachments** (ATC, scope of work, BOQ Excel, SLA) are **links inside that PDF**, in its `/URI` entries. They download with plain GET and no login:
  - `https://bidplus.gem.gov.in/resources/upload_nas/<Qtr>/bidding/biddoc/bid-<b_id>/<n>.pdf`
  - `…/bidding/excel/bid-<b_id>/<n>.xlsx`
  - `https://fulfilment.gem.gov.in/contract/slafds?fileDownloadPath=…pdf`
  - Links to the general GTC (`admin.gem.gov.in/apis/v1/gtc/…`) and `bidsla` pages are generic and can be skipped.
- **Corrigendum and representation:** `POST /public-bid-other-details/<b_id>` says whether either exists. `POST /bidding/bid/viewCorrigendum/<b_id>` returns the corrigendum.

`robots.txt` disallows `/resources/` for crawlers. We would fetch only the attachments of tenders the operator keeps, at a human pace, the same as a person clicking the links.

## 4. How GeM differs from the GePNIC (NIC) sites TenderAssist runs today

| | NIC sites (today) | GeM |
|---|---|---|
| Sign-in to search | Yes: login, CAPTCHA, DSC | **No** |
| How we read it | Drive the page in the embedded browser | **JSON over HTTP**, no browser needed |
| Find by | Published date and product category | Keyword, type, category code, buyer state or ministry, delivery state or city, end date. No published-date filter. |
| Details | Details page in "My Tenders" after adding to favourites | List record plus bid PDF |
| Documents | Download from the signed-in page, then zip | Bid PDF plus the attachment links inside it |
| Unit of a run | One published date | Any search. "New since last run", found by start date, fits best. |

So GeM should not reuse the browser, sign-in or favourites flow at all. It needs its own small adapter: an HTTP client and a parser. Its tenders then flow into the same opportunities, word checks, "Keep or skip?", Inbox, Eligibility sheet and Drive copy.

## 5. How TenderAssist uses GeM (built 7 Oct 2026)

Agreed with the operator:

- **No location filter.** A bid anywhere in India is a match if it is in a chosen GeM category and mentions an intent word.
- **Every website keeps its own categories** (`categoriesByPortal` in the run settings), picked from that website's own dropdown:
  - GePNIC sites show their Product Category list, read during a search;
  - GeM shows its Category list exactly as GeM displays it (about 421 service entries; GeM adds an example after " - "), read from the advanced search page and refreshed every two weeks.
- **Bids are matched by GeM's own category code**, as GeM's search does. A bid for several items carries several comma-separated codes, and any one of them counts. If the list could not be read, the category name before " - " is compared instead.
- **The starting GeM picks** cover application development, e-learning, software support, websites and mobile apps, plus "Custom Bid For Services". GeM's "Annual Maintenance Service" entries are all hardware AMC, so they are left for the operator to add.
- **Services by default.** "Also search product bids" adds product bids, and product categories join the list.
- **Every bid type is kept**, including reverse auctions and limited, single or global tenders. The type is written on the sheet ("Bid Type").
- **Dates mean the day a bid started**, chosen with the same date picker as the other websites.

How a GeM date runs (`src/gem/`):

1. **No sign-in, no portal window.** The run panel stands alone, with no "Sign in" step and no DSC or OpenWebStart check.
2. **Finding the date** (`gemDaySearch.ts`):
   - the list is read newest-start-first, and the first page of the day is found by halving the page range;
   - pages are then read until the day ends;
   - a day has about 1,000 service bids (about 110 pages, roughly 1.5 minutes at the gentle pace).
3. **Screening every bid on its list record** (`gemRunner.ts`). The category must be one of yours, and the title must have no excluded word. Bids failing either are rejected without being opened.
4. **Reading each remaining bid's PDF** (`gemBidDocument.ts`, using pdf.js). This gives:
   - the facts for the sheet (end and opening dates, estimated value, EMD, ePBG, turnover, experience, MSE and startup relaxation, contract period, documents required);
   - the buyer's attachments, named as the bid names them.

   Intent words are checked against the title plus the bid-specific part of the PDF; GeM's general terms after "Disclaimer" are left out. "Keep or skip?" works as on other websites, with an "Open the bid document" button.
5. **Saving files.** Kept bids get the bid PDF and its attachments saved through the same output folders, day workbook and eligibility sheet. "Collect their documents" works for approved GeM tenders, again with no sign-in. A tender approved after being rejected on its category has its PDF read first.
6. **Pace and retries.** There is a 0.6–1.4 s pause between requests (0.2 s on "Fast"). GeM sometimes answers HTTP 500 when asked quickly; that counts as temporary and is retried after 5, 15 and 40 seconds.
