import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

// Reads the text inside a saved tender document. A PDF's own text is used
// page by page; a page with almost none (a scan) goes to OCR. Images go to
// OCR whole. Other files (Excel BOQs, Word, zips) are not read here.

export interface DocumentRead {
  text: string;
  method: 'TEXT' | 'OCR' | 'MIXED' | 'NONE';
  pages: number;
  ocrPages: number;
}

export interface OcrEngine {
  pdfPages(pdfPath: string, pages: number[]): Promise<Map<number, string>>;
  image(imagePath: string): Promise<string>;
}

/** A page with fewer characters than this is treated as a scan. */
const SCANNED_PAGE_CHARS = 40;
/** OCR reads a scanned document this many pages at a time, to keep runs short. */
export const MAX_OCR_PAGES = 15;
/** A long scanned notice is read further, batch by batch, only to reach its eligibility criteria. */
export const MAX_OCR_PAGES_IN_ALL = 60;

const CRITERIA_WORDS = /eligi?bi?li?ty|pre[\s-]*qualification|qualification\s+criteria|qualifying\s+criteria/i;

/**
 * Whether to OCR the next batch of a scanned document: its eligibility
 * criteria have not been read yet, or they start on one of the last three
 * pages read, so they may run on.
 */
export function readMoreForCriteria(ocrText: ReadonlyMap<number, string>, lastBatch: readonly number[]): boolean {
  const withCriteria = [...ocrText].filter(([, text]) => CRITERIA_WORDS.test(text)).map(([page]) => page);
  if (withCriteria.length === 0) return true;
  return lastBatch.slice(-3).includes(Math.max(...withCriteria));
}

const IMAGE = /^\.(?:jpe?g|png|tiff?|bmp)$/i;

export function canReadDocument(path: string): boolean {
  const extension = extname(path);
  return /^\.pdf$/i.test(extension) || IMAGE.test(extension);
}

async function pdfPageTexts(path: string): Promise<string[]> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(readFileSync(path)), useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  const texts: string[] = [];
  for (let number = 1; number <= doc.numPages; number += 1) {
    const content = await (await doc.getPage(number)).getTextContent();
    let line = '';
    const lines: string[] = [];
    for (const item of content.items as Array<{ str?: string; hasEOL?: boolean }>) {
      line += item.str ?? '';
      if (item.hasEOL) { lines.push(line); line = ''; }
    }
    if (line) lines.push(line);
    texts.push(lines.join('\n').replace(/[ \t]+/g, ' ').trim());
  }
  await task.destroy();
  return texts;
}

export async function readDocumentText(path: string, ocr: OcrEngine | null): Promise<DocumentRead> {
  if (IMAGE.test(extname(path))) {
    if (!ocr) return { text: '', method: 'NONE', pages: 1, ocrPages: 0 };
    const text = (await ocr.image(path)).trim();
    return { text, method: text ? 'OCR' : 'NONE', pages: 1, ocrPages: 1 };
  }
  const pages = await pdfPageTexts(path);
  const allScanned = pages.map((text, index) => (text.length < SCANNED_PAGE_CHARS ? index + 1 : 0)).filter(Boolean);
  // OCR trouble keeps the PDF's own text; the scanned pages stay unread.
  const ocrText = new Map<number, string>();
  if (ocr) {
    for (let from = 0; from < Math.min(allScanned.length, MAX_OCR_PAGES_IN_ALL); from += MAX_OCR_PAGES) {
      const batch = allScanned.slice(from, from + MAX_OCR_PAGES);
      for (const [page, text] of await ocr.pdfPages(path, batch).catch(() => new Map<number, string>())) ocrText.set(page, text);
      if (!readMoreForCriteria(ocrText, batch)) break;
    }
  }
  const merged = pages.map((text, index) => (ocrText.get(index + 1)?.trim() || text));
  const text = merged.map((page, index) => (page ? `[Page ${index + 1}]\n${page}` : '')).filter(Boolean).join('\n\n');
  const usedOcr = [...ocrText.values()].filter((page) => page.trim()).length;
  const ownText = pages.filter((page) => page.length >= SCANNED_PAGE_CHARS).length;
  const method = !text ? 'NONE' : usedOcr === 0 ? 'TEXT' : ownText === 0 ? 'OCR' : 'MIXED';
  return { text, method, pages: pages.length, ocrPages: usedOcr };
}

/** The documents' text joined for reading requirements, each under its file name. */
export function documentsTextFor(documents: Array<{ file_name: string; text_content?: string | null }>): string {
  return documents.filter((document) => document.text_content)
    .map((document) => `=== ${document.file_name} ===\n${document.text_content}`)
    .join('\n\n');
}

/** The operator's words found in a text, as whole words, ignoring case. */
export function wordsFoundIn(text: string, words: readonly string[]): string[] {
  return words.filter((word) => {
    const escaped = word.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return escaped !== '' && new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'i').test(text);
  });
}
