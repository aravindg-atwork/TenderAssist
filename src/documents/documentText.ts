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
/** OCR stops after this many pages of one document, to keep runs short. */
export const MAX_OCR_PAGES = 15;

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
  const scanned = pages.map((text, index) => (text.length < SCANNED_PAGE_CHARS ? index + 1 : 0)).filter(Boolean).slice(0, MAX_OCR_PAGES);
  // OCR trouble keeps the PDF's own text; the scanned pages stay unread.
  const ocrText = ocr && scanned.length > 0 ? await ocr.pdfPages(path, scanned).catch(() => new Map<number, string>()) : new Map<number, string>();
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
