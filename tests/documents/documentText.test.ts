import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canReadDocument, documentsTextFor, readDocumentText, wordsFoundIn, type OcrEngine } from '../../src/documents/documentText.js';

/** A small PDF: page 1 has text, page 2 has none (as a scanned page would). */
function twoPagePdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 6 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => { offsets.push(body.length); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

describe('readDocumentText', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ta-doctext-'));

  it('uses the PDF text where there is some and OCR for a page without', async () => {
    const path = join(dir, 'notice.pdf');
    writeFileSync(path, twoPagePdf('Eligibility: average turnover 50 lakh for website development'));
    const asked: number[][] = [];
    const ocr: OcrEngine = {
      pdfPages: async (_path, pages) => { asked.push(pages); return new Map([[2, 'EMD Rs. 25,000 (scanned page)']]); },
      image: async () => '',
    };
    const read = await readDocumentText(path, ocr);
    expect(asked).toEqual([[2]]);
    expect(read).toMatchObject({ method: 'MIXED', pages: 2, ocrPages: 1 });
    expect(read.text).toContain('[Page 1]\nEligibility: average turnover 50 lakh');
    expect(read.text).toContain('[Page 2]\nEMD Rs. 25,000');
  });

  it('keeps the PDF text when OCR fails', async () => {
    const path = join(dir, 'notice2.pdf');
    writeFileSync(path, twoPagePdf('Scope of work: mobile app development'));
    const read = await readDocumentText(path, { pdfPages: async () => { throw new Error('no OCR'); }, image: async () => '' });
    expect(read).toMatchObject({ method: 'TEXT', ocrPages: 0 });
    expect(read.text).toContain('mobile app development');
  });

  it('reads an image by OCR, and only PDFs and images', async () => {
    const read = await readDocumentText(join(dir, 'scan.jpg'), { pdfPages: async () => new Map(), image: async () => 'Pre-qualification criteria' });
    expect(read).toEqual({ text: 'Pre-qualification criteria', method: 'OCR', pages: 1, ocrPages: 1 });
    expect(canReadDocument('BOQ_847931.xls')).toBe(false);
    expect(canReadDocument('Tendernotice_1.PDF')).toBe(true);
  });
});

describe('document words', () => {
  it('finds whole words and phrases, ignoring case', () => {
    expect(wordsFoundIn('Development of a Mobile  App and website', ['mobile app', 'web', 'website', 'AMC'])).toEqual(['mobile app', 'website']);
  });

  it('joins documents under their names', () => {
    expect(documentsTextFor([{ file_name: 'a.pdf', text_content: 'one' }, { file_name: 'b.pdf', text_content: null }]))
      .toBe('=== a.pdf ===\none');
  });
});
