// How much a new tender looks like the tenders the office approved or won:
// TF-IDF over their titles and work descriptions, compared by cosine
// similarity. Offline and plain arithmetic: no AI service. Built once per
// set of approved tenders, then each match reads only the postings of the
// new tender's own words, so thousands of tenders stay fast.

/** A tender the office approved or won, as the index holds it. */
export interface SimilarityDocument {
  id: string;
  title: string;
  /** Its work description or scope, when known. */
  text?: string | null;
}

export interface SimilarTender {
  id: string;
  title: string;
  /** Cosine similarity, 0 to 1. */
  similarity: number;
}

export interface SimilarityMatch {
  /** The best similarity found, 0 when nothing shares a word. */
  best: number;
  /** The most similar approved tenders, most similar first (at most `limit`). */
  similar: SimilarTender[];
}

// Words that say nothing about the kind of work: English joining words, and
// what nearly every Indian tender title carries ("Tender for supply of …",
// "Custom Bid for Services - …", "e-Tender", the department). Stemmed forms.
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or',
  'the', 'this', 'that', 'to', 'with', 'within', 'under', 'via', 'all', 'any', 'other', 'etc', 'per', 'new', 'existing',
  'tender', 'etender', 'bid', 'supply', 'work', 'department', 'dept', 'service', 'custom', 'providing', 'provision',
  'procurement', 'item', 'name', 'year', 'contract', 'rate', 'quotation', 'invitation', 'notice', 'nit',
  'office', 'government', 'govt', 'tamil', 'nadu', 'india',
]);

/** "applications" → "application", "agencies" → "agency"; short words and "-ss", "-us", "-is" stay. */
export function stem(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith('sses')) return word.slice(0, -2);
  if (word.endsWith('ss') || word.endsWith('us') || word.endsWith('is')) return word;
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/** The words of a text that say what the work is: lower case, stemmed, without stop words or numbers. */
export function tokenize(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !/^[0-9]+$/.test(word))
    .map(stem)
    .filter((word) => !STOP_WORDS.has(word));
}

function termCounts(words: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  return counts;
}

interface Posting {
  doc: number;
  /** The word's weight in that document, already divided by the document's length. */
  weight: number;
}

export class SimilarityIndex {
  private readonly postings = new Map<string, Posting[]>();
  private readonly documentFrequency = new Map<string, number>();
  private readonly documents: SimilarityDocument[];

  constructor(documents: readonly SimilarityDocument[]) {
    this.documents = [...documents];
    const counts = this.documents.map((document) => termCounts(tokenize(`${document.title} ${document.text ?? ''}`)));
    for (const terms of counts) for (const term of terms.keys()) this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1);
    counts.forEach((terms, doc) => {
      const weights = [...terms].map(([term, count]) => [term, (1 + Math.log(count)) * this.idf(term)] as const);
      const length = Math.sqrt(weights.reduce((sum, [, weight]) => sum + weight * weight, 0));
      if (length === 0) return;
      for (const [term, weight] of weights) {
        const list = this.postings.get(term) ?? [];
        list.push({ doc, weight: weight / length });
        this.postings.set(term, list);
      }
    });
  }

  /** How many approved tenders the index holds. */
  get size(): number {
    return this.documents.length;
  }

  // Smoothed, so a word in every approved tender still counts a little and an unseen word counts most.
  private idf(term: string): number {
    return Math.log((this.documents.length + 1) / ((this.documentFrequency.get(term) ?? 0) + 1)) + 1;
  }

  /**
   * The approved tenders most like this text. `excludeId` leaves out the
   * tender itself (an approved tender is never "like" itself); the same
   * title approved twice (a retender) is named once.
   */
  match(text: string, options: { excludeId?: string; limit?: number } = {}): SimilarityMatch {
    const limit = options.limit ?? 3;
    const terms = termCounts(tokenize(text));
    if (terms.size === 0 || this.documents.length === 0) return { best: 0, similar: [] };
    const scores = new Float64Array(this.documents.length);
    let queryLength = 0;
    for (const [term, count] of terms) {
      const weight = (1 + Math.log(count)) * this.idf(term);
      queryLength += weight * weight;
      for (const posting of this.postings.get(term) ?? []) scores[posting.doc] += weight * posting.weight;
    }
    queryLength = Math.sqrt(queryLength);
    const ranked = [...scores.keys()]
      .filter((doc) => scores[doc] > 0 && this.documents[doc].id !== options.excludeId)
      .sort((a, b) => scores[b] - scores[a]);
    const similar: SimilarTender[] = [];
    const titles = new Set<string>();
    for (const doc of ranked) {
      const document = this.documents[doc];
      const key = document.title.trim().toLowerCase();
      if (titles.has(key)) continue;
      titles.add(key);
      similar.push({ id: document.id, title: document.title, similarity: Math.min(1, scores[doc] / queryLength) });
      if (similar.length >= limit) break;
    }
    return { best: similar[0]?.similarity ?? 0, similar };
  }
}
