// How well TenderAssist reads tenders, measured on real ones:
//
//   npm run build && npm run check:reading -- "C:\Users\<you>\Documents\TenderAssist" [--ocr] [--expected expected.json]
//
// Reads every saved tender folder's Documents (with Windows OCR for scanned
// pages when --ocr is given) and reports, per tender, the qualification
// sections and points found. With --expected (a JSON file mapping a tender
// folder's name to the number of pre-qualification points a person counted in
// its documents), it also scores each tender against that count. Tender
// documents stay where they are; nothing is copied or uploaded.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { canReadDocument, readDocumentText, type OcrEngine } from '../documents/documentText.js';
import { ocrImage, ocrPdfPages, windowsOcrAvailable } from '../documents/windowsOcr.js';
import { findQualificationSections } from '../extraction/qualificationSections.js';

function tenderFolders(root: string): string[] {
  const found: string[] = [];
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder)) {
      const path = join(folder, entry);
      if (!statSync(path).isDirectory()) continue;
      if (existsSync(join(path, 'Documents'))) found.push(path);
      else walk(path);
    }
  };
  walk(root);
  return found.sort();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const root = args.find((arg) => !arg.startsWith('--') && args[args.indexOf(arg) - 1] !== '--expected');
  if (!root || !existsSync(root)) {
    console.error('Give the folder TenderAssist saves tenders in, for example "C:\\Users\\you\\Documents\\TenderAssist".');
    process.exitCode = 1;
    return;
  }
  const expectedPath = args.includes('--expected') ? args[args.indexOf('--expected') + 1] : undefined;
  const expected = expectedPath ? JSON.parse(readFileSync(expectedPath, 'utf8')) as Record<string, number> : {};
  const ocr: OcrEngine | null = args.includes('--ocr') && windowsOcrAvailable() ? { pdfPages: ocrPdfPages, image: ocrImage } : null;

  let withText = 0;
  let withCriteria = 0;
  let scored = 0;
  let exact = 0;
  for (const folder of tenderFolders(root)) {
    const documentsFolder = join(folder, 'Documents');
    const documents: Array<{ name: string; text: string }> = [];
    for (const name of readdirSync(documentsFolder)) {
      const path = join(documentsFolder, name);
      if (!statSync(path).isFile() || !canReadDocument(path)) continue;
      try { documents.push({ name, text: (await readDocumentText(path, ocr)).text }); }
      catch { documents.push({ name, text: '' }); }
    }
    const readable = documents.filter((document) => document.text.trim().length >= 200).length;
    const sections = findQualificationSections(documents);
    const criteria = sections.find((section) => section.kind === 'PRE_QUALIFICATION');
    const points = criteria ? Math.max(criteria.items.length, 1) : 0;
    if (readable > 0) withText += 1;
    if (criteria) withCriteria += 1;
    const name = basename(folder);
    let score = '';
    if (expected[name] !== undefined) {
      scored += 1;
      if (expected[name] === points) exact += 1;
      score = expected[name] === points ? '  ✓ as counted' : `  ✗ counted ${expected[name]}`;
    }
    const kinds = sections.map((section) => `${section.kind.toLowerCase().replace(/_/g, ' ')} (${section.items.length})`).join(', ');
    console.log(`${name.slice(0, 72).padEnd(72)} ${readable}/${documents.length} readable | ${criteria ? `${points} criteria from “${criteria.heading.slice(0, 40)}”` : 'no criteria found'}${score}`);
    if (kinds) console.log(`${''.padEnd(72)}   ${kinds}`);
  }
  console.log(`\nCriteria found for ${withCriteria} of ${withText} tenders with readable documents.`);
  if (scored > 0) console.log(`Point counts as a person counted them: ${exact} of ${scored}.`);
  if (!ocr) console.log('Scanned pages were not read; add --ocr to read them with Windows OCR (slower).');
}

void main();
