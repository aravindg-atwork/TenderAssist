// Finds the parts of a tender's documents a bidder must read before deciding
// to bid: the pre-qualification (eligibility) criteria, the technical
// evaluation criteria, the documents to submit, and the buyer's own terms on
// GeM. Read by headings and word patterns, never by AI; the text is kept as
// the document wrote it, only unwrapped.

export type QualificationKind = 'PRE_QUALIFICATION' | 'TECHNICAL_EVALUATION' | 'DOCUMENTS_REQUIRED' | 'BUYER_TERMS';

export interface QualificationSection {
  kind: QualificationKind;
  /** The heading as the document wrote it. */
  heading: string;
  /** The file the section came from. */
  document: string;
  /** The page it starts on, when the text marks pages. */
  page: number | null;
  /** The section, unwrapped into paragraphs. */
  text: string;
  /** Its numbered points (1, 2, 3…), when it has at least two; otherwise empty. */
  items: string[];
}

export const QUALIFICATION_KIND_LABELS: Record<QualificationKind, string> = {
  PRE_QUALIFICATION: 'Pre-qualification / eligibility',
  TECHNICAL_EVALUATION: 'Technical evaluation',
  DOCUMENTS_REQUIRED: 'Documents to submit',
  BUYER_TERMS: 'Buyer’s terms (ATC)',
};

// "Eligibility", also as tenders misspell it ("Eligiblity").
const ELIGIBILITY = String.raw`eligi?bi?li?ty`;
const QUALIFYING = String.raw`(?:pre[\s-]*qualification|${ELIGIBILITY}|qualifying|qualification)`;

const HEADINGS: Array<{ kind: QualificationKind; pattern: RegExp }> = [
  // "Eligibility Criteria", "Qualification/Eligibility/Evaluation Criteria", "Qualification criteria of the bidders".
  { kind: 'PRE_QUALIFICATION', pattern: new RegExp(String.raw`\b${QUALIFYING}(?:\s*[/&,]\s*(?:${QUALIFYING}|evaluation))*\s+(?:evaluation\s+)?(?:criteria|criterion|requirements?|conditions?)\b|\beligible\s+bidders?\b|\bminimum\s+${ELIGIBILITY}\b|\bbidders?['’]?s?\s+${ELIGIBILITY}\b|\bqualification\s+of\s+(?:the\s+)?bidders?\b`, 'i') },
  { kind: 'TECHNICAL_EVALUATION', pattern: /\btechnical\s+(?:evaluation|qualification|bid\s+evaluation)(?:\s+criteria)?\b|(?<!commercial\s|financial\s|price\s)\bevaluation\s+criteria\b/i },
  { kind: 'DOCUMENTS_REQUIRED', pattern: /\b(?:list\s+of\s+)?documents?\s+(?:to\s+be\s+)?(?:required|submitted|uploaded|enclosed)\b|\bcheck\s*-?\s*list\b/i },
];

const MAX_SECTION_CHARS = 9000;
const MAX_SECTION_PAGES = 5;
const NUMBER = /^((?:\d{1,2}\.){0,3}\d{1,2})\.?\s+(?=\S)/;

const isPageMarker = (line: string) => /^\[Page \d+\]$/.test(line);
const isPageFooter = (line: string) => /^\d{1,4}\s*\|\s*P\s*a\s*g\s*e$/i.test(line) || /^page\s+\d+\s+(?:of\s+\d+)?$/i.test(line);

/** A line that reads as a heading, not a sentence, a contents entry or a table caption. */
/**
 * With `named`, the line is known to name a section (it matches HEADINGS), so
 * a short sentence-case heading such as "Qualification criteria of the bidders." counts too.
 */
function isHeadingLine(raw: string, named = false): boolean {
  // A lettered heading ("A. Eligibility Criteria") reads as an unnumbered one; a heading may end in one full stop.
  const line = raw.replace(/^[A-H][.)]\s+(?=[A-Z])/, '').replace(/(?<=[a-z])\.$/, '');
  if (line.length < 4 || line.length > 140) return false;
  if (/\.{4,}|…{2,}|\s\d{1,3}$/.test(line) && /\.{3,}|…/.test(line)) return false; // contents: "5.5 Criteria ........ 32"
  if (/^(?:table|form|figure|annexure|appendix)\s*[-–:]?\s*[\dIVX]/i.test(line)) return false;
  if (/\b(?:shall|will|should|must|may\s+be|refer|referred|mentioned|as\s+per|in\s+accordance|subject\s+to)\b/i.test(line)) return false;
  if (/[,;]$/.test(line)) return false;
  const rest = line.replace(NUMBER, '');
  if (!/^[A-Z(]/.test(rest)) return false;
  const words = rest.split(/\s+/);
  const long = words.filter((word) => /^[A-Za-z]{4,}/.test(word));
  const titleCase = long.length > 0 && long.filter((word) => /^[A-Z]/.test(word)).length / long.length >= 0.6;
  // "5.5 Pre-qualification criteria" or "6. Eligibility" is a heading; "40 Crore in the last three years" is a wrapped line.
  if (/^\d{1,2}(?:\.\d{1,2}){1,3}\.?\s|^\d{1,2}\.\s/.test(line)) return words.length <= 14;
  if (NUMBER.test(line)) return words.length <= 14 && titleCase;
  // Unnumbered: a short line in Title Case or capitals ("Eligibility Criteria"), not a wrapped sentence.
  return !/[.,]/.test(rest) && ((words.length <= 9 && titleCase) || (named && words.length <= 7));
}

/** "5.5.1" → [5, 5, 1]; null for an unnumbered line. */
function numberOf(line: string): number[] | null {
  const match = NUMBER.exec(line);
  return match ? match[1].split('.').map(Number) : null;
}

/** Whether `next` is a heading at the same or a higher level than `start`, so the section has ended. */
function endsSection(start: number[] | null, next: number[] | null): boolean {
  if (!start || !next) return false;
  if (next.length > start.length) return false; // a sub-section such as 5.5.1 under 5.5
  // A later heading (5.6 or 6 after 5.5) ends it; a lower number (row "1" of a table) does not.
  for (let level = 0; level < next.length; level += 1) {
    if (next[level] !== start[level]) return next[level] > start[level];
  }
  return false;
}

/** Lines into paragraphs: a line joins the one before unless that ended a sentence or this starts a point. */
export function unwrap(lines: readonly string[]): string {
  const paragraphs: string[] = [];
  for (const line of lines) {
    const last = paragraphs.at(-1);
    // "…turnover of at least INR" + "40 Crore…" is one sentence, not point 40.
    const continues = last !== undefined && /(?:\bINR|\bRs\.?|₹|\bof|\bthan|\bleast|\bupto|\bto|\band|\bor|[-–])$/i.test(last);
    const startsPoint = !continues && (/^(?:\d{1,2}[.)]?|\(?[a-z]\)|\(?[ivx]{1,4}\)|[A-H]\.|[●•▪◦\-–*])\s/i.test(line) || /^\d{1,2}$/.test(line));
    if (last !== undefined && !startsPoint && !/[.:;!?]$/.test(last) && !/^\d{1,2}$/.test(last)) {
      paragraphs[paragraphs.length - 1] = /-$/.test(last) ? `${last}${line}` : `${last} ${line}`;
    } else if (last !== undefined && /^\d{1,2}$/.test(last)) {
      paragraphs[paragraphs.length - 1] = `${last} ${line}`;
    } else {
      paragraphs.push(line);
    }
  }
  return paragraphs.join('\n');
}

/** The numbered points 1, 2, 3… of a section, when it lists at least two in order. */
export function numberedItems(text: string): string[] {
  const items: string[] = [];
  let expected = 1;
  // Points labelled "PQ1:", "TQ 2:", "EC-3." count as 1, 2, 3 too.
  for (const paragraph of text.replace(/\s+(?=(?:PQ|TQ|EC|QC)\s*-?\s*\d{1,2}\s*[:.)]\s)/g, '\n').split('\n')) {
    const match = /^(?:(?:PQ|TQ|EC|QC)\s*-?\s*)?(\d{1,2})\s*[:.)]?\s+(.+)$/.exec(paragraph);
    // A lettered group ("B. Bidder Experience (35 marks)") starts its own 1, 2, 3…
    if (items.length > 0 && /^[A-H]\.\s+\S/.test(paragraph)) {
      items.push(paragraph);
      expected = 1;
    } else if (match && Number(match[1]) === expected) {
      items.push(paragraph);
      expected += 1;
    } else if (items.length > 0) {
      items[items.length - 1] += `\n${paragraph}`;
    }
  }
  return items.length >= 2 ? items : [];
}

/** The repeated header row of a table that runs over pages ("# Parameter Criteria …"). */
function isRepeatedTableHeader(line: string, seen: Set<string>): boolean {
  if (!/^#\s/.test(line) && !/^(?:s\.?\s*no\.?|sl\.?\s*no\.?)\b/i.test(line)) return false;
  if (seen.has(line)) return true;
  seen.add(line);
  return false;
}

function sectionsIn(document: string, text: string): QualificationSection[] {
  const lines = text.split('\n').map((line) => line.replace(/\s+/g, ' ').trim());
  const pages: Array<number | null> = [];
  let page: number | null = null;
  for (const line of lines) {
    const marker = /^\[Page (\d+)\]$/.exec(line);
    if (marker) page = Number(marker[1]);
    pages.push(page);
  }
  const found: QualificationSection[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const kind = HEADINGS.find((heading) => heading.pattern.test(line))?.kind;
    if (!kind || !isHeadingLine(line, true)) continue;
    const start = numberOf(line);
    const body: string[] = [];
    const headers = new Set<string>();
    let length = 0;
    let end = index + 1;
    // The criteria are often a table with rows 1, 2, 3…: the next row number is a row, not a chapter.
    let nextRow = 1;
    for (; end < lines.length; end += 1) {
      const next = lines[end];
      if (!next || isPageMarker(next) || isPageFooter(next)) continue;
      const row = /^(\d{1,2})(?:\s|$)/.exec(next);
      if (row && Number(row[1]) === nextRow) {
        nextRow += 1;
      } else if (isHeadingLine(next) && endsSection(start, numberOf(next))) break;
      // Unnumbered: the next heading of another kind, or any numbered heading, ends it.
      if (!start && isHeadingLine(next) && numberOf(next) && !/^\d{1,2}\s/.test(next)) break;
      if (!start && isHeadingLine(next) && HEADINGS.some((heading) => heading.kind !== kind && heading.pattern.test(next))) break;
      if (start && pages[end] !== null && pages[index] !== null && pages[end]! - pages[index]! >= MAX_SECTION_PAGES) break;
      if (isRepeatedTableHeader(next, headers)) continue;
      body.push(next);
      length += next.length;
      if (length > MAX_SECTION_CHARS) break;
    }
    const sectionText = unwrap(body);
    // Too little to be the criteria themselves: a heading followed by a cross-reference.
    if (sectionText.length < 120) continue;
    found.push({ kind, heading: line, document, page: pages[index], text: sectionText, items: numberedItems(sectionText) });
  }
  // A sub-section is read on its own too ("5.1 Pre-Qualification Criteria" under "5. Evaluation Criteria"):
  // one that only repeats part of a longer section of the same kind is dropped.
  return found.filter((section) => !found.some((other) => other !== section && other.kind === section.kind
    && other.text.length > section.text.length && other.text.includes(section.text.slice(0, 400))));
}

/**
 * The buyer's text clauses in a GeM bid PDF ("Buyer Added text based ATC
 * clauses"), up to GeM's own standard clauses or disclaimer.
 */
function gemBuyerTerms(document: string, text: string): QualificationSection | null {
  const lines = text.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter((line) => line && !isPageMarker(line));
  const start = lines.findIndex((line) => /Buyer Added text based ATC clauses/i.test(line));
  if (start < 0) return null;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\d+\.\s*(?:Generic|Buyer Added Bid Specific ATC)\b/i.test(line) || /Disclaimer/i.test(line)) break;
    // The PDF is in Hindi and English: keep the English lines.
    if (!/[A-Za-z]{2}/.test(line)) continue;
    body.push(line);
  }
  // GeM wraps mid-word ("sa\nid"): join without a space where a line ends inside a word.
  const joined = body.reduce<string[]>((paragraphs, line) => {
    const last = paragraphs.at(-1);
    if (last === undefined || /^\d{1,2}\.\s/.test(line) || /^\([a-z]\)\s/i.test(line)) paragraphs.push(line);
    else paragraphs[paragraphs.length - 1] = /[a-z]$/.test(last) && /^[a-z]/.test(line) && !/\s\w{1,3}$/.test(last) ? `${last}${line}` : `${last} ${line}`;
    return paragraphs;
  }, []).join('\n');
  return joined.length >= 20
    ? { kind: 'BUYER_TERMS', heading: 'Buyer Added text based ATC clauses', document, page: null, text: joined, items: numberedItems(joined) }
    : null;
}

/** How GeM evaluates a QCBS or L1 bid, from its bid PDF. */
export function gemEvaluationNote(text: string): string | null {
  const flat = text.replace(/\s+/g, ' ');
  const qcbs = /This Bid is based on Quality & Cost Based Selection \(QCBS\)/i.test(flat);
  const marks = /Total Qualifying Marks for Technical Qualification:\s*(\d+)/i.exec(flat)?.[1];
  const weightage = /QCBS Weightage\(Technical:Financial\):\s*(\d+\s*:\s*\d+)/i.exec(flat)?.[1];
  if (!qcbs && !marks) return null;
  return [qcbs && 'Quality and cost based selection (QCBS)', marks && `technical qualifying marks ${marks}`, weightage && `weightage technical:financial ${weightage.replace(/\s/g, '')}`]
    .filter(Boolean).join('; ');
}

/**
 * Every qualification section in a tender's documents, the fullest of each
 * kind first. A file GeM attaches under two names is read once.
 */
export function findQualificationSections(documents: ReadonlyArray<{ name: string; text: string | null | undefined }>): QualificationSection[] {
  const seenTexts = new Set<string>();
  const sections: QualificationSection[] = [];
  for (const document of documents) {
    const text = document.text ?? '';
    if (!text.trim()) continue;
    const key = `${text.length}:${text.slice(0, 2000)}`;
    if (seenTexts.has(key)) continue;
    seenTexts.add(key);
    const terms = gemBuyerTerms(document.name, text);
    if (terms) sections.push(terms);
    // GeM's own bid PDF mixes Hindi and English on every line; its facts are read separately (gemBidDocument).
    if (!isGemBidPdf(text)) sections.push(...sectionsIn(document.name, text));
  }
  // No eligibility heading anywhere: the numbered conditions that ask for what
  // criteria ask for ("8. Bidder Turnover should be more than Rupees 45 Lakhs").
  if (!sections.some((section) => section.kind === 'PRE_QUALIFICATION')) {
    const asks = /turn\s*-?\s*over|years?\s+of\s+(?:past\s+)?experience|experience\s+of|\bISO\s*\d|\bCMMI\b|black\s*-?\s*list|debar|net\s*-?\s*worth|similar\s+(?:projects?|works?|orders?)|registered\s+under|incorporated/i;
    // The document with the most such conditions.
    let best: { name: string; items: string[] } | null = null;
    for (const document of documents) {
      const text = document.text ?? '';
      if (!text.trim() || isGemBidPdf(text)) continue;
      const lines = text.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter((line) => line && !isPageMarker(line) && !isPageFooter(line));
      // Every numbered point, wherever its numbering starts (a list of terms may begin at 7).
      const points = unwrap(lines).split('\n').reduce<string[]>((all, paragraph) => {
        if (/^\d{1,2}[.)]\s+\S/.test(paragraph)) all.push(paragraph);
        else if (all.length > 0 && !/^[A-Z][A-Za-z ]{2,60}$/.test(paragraph)) all[all.length - 1] += ` ${paragraph}`;
        return all;
      }, []);
      const items = points.filter((item) => asks.test(item));
      if (items.length > (best?.items.length ?? 0)) best = { name: document.name, items };
    }
    if (best) {
      sections.push({ kind: 'PRE_QUALIFICATION', heading: `Conditions in ${best.name}`, document: best.name, page: null, text: best.items.join('\n'), items: best.items.length >= 2 ? best.items : [] });
    }
  }
  const seenSections = new Set<string>();
  return sections
    .filter((section) => {
      const key = `${section.kind}:${section.text.slice(0, 300)}`;
      if (seenSections.has(key)) return false;
      seenSections.add(key);
      return true;
    })
    .sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind) || b.text.length - a.text.length);
}

/**
 * The criteria in a few lines for the report sheet: the points of the
 * fullest pre-qualification section, each cut to its first sentence, and any
 * buyer term that limits who may bid.
 */
export function criteriaSummary(sections: readonly QualificationSection[], maxChars = 1500): string | null {
  const criteria = sections.find((section) => section.kind === 'PRE_QUALIFICATION');
  const points = criteria ? (criteria.items.length > 0 ? criteria.items : [criteria.text]).map((point) => firstSentence(point)) : [];
  const limit = /\bonly\b[^.]{0,80}\beligible\b|\bshortlisted\b|\bnot\s+eligible\b|\bonly\s+(?:those|the\s+following)\b/i;
  // The sentence that limits who may bid, with any list of names after it.
  const limits = sections.filter((section) => section.kind === 'BUYER_TERMS')
    .flatMap((section) => section.items.length > 0 ? section.items : [section.text])
    .filter((term) => limit.test(term))
    .map((term) => {
      const flat = term.replace(/\s+/g, ' ');
      const from = flat.slice(0, flat.search(limit)).search(/[^.]*$/);
      const rest = flat.slice(Math.max(0, from)).trim();
      return `Buyer’s terms: ${rest.length > 400 ? `${rest.slice(0, 399).trimEnd()}…` : rest}`;
    });
  const lines = [...limits, ...points];
  if (lines.length === 0) return null;
  let summary = '';
  for (const line of lines) {
    if (summary.length + line.length + 1 > maxChars) return `${summary}\n… (more on the Eligibility sheet)`.trim();
    summary = summary ? `${summary}\n${line}` : line;
  }
  return summary;
}

function firstSentence(text: string, maxChars = 200): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const end = flat.search(/(?<=[a-z)\]]{2}[.;])\s/);
  const sentence = end > 0 ? flat.slice(0, end) : flat;
  return sentence.length > maxChars ? `${sentence.slice(0, maxChars - 1).trimEnd()}…` : sentence;
}

function isGemBidPdf(text: string): boolean {
  return /\bGEM\/\d{4}\/[BR]\/\d+/.test(text) && /\/\s*Bid Details|Bid Document|RA Start Date/.test(text);
}

function kindOrder(kind: QualificationKind): number {
  return ['PRE_QUALIFICATION', 'BUYER_TERMS', 'TECHNICAL_EVALUATION', 'DOCUMENTS_REQUIRED'].indexOf(kind);
}
