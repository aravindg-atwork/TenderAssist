import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { filesForDrive, isGemStandardForm } from '../../src/publishing/driveSelection.js';

describe('what of a tender folder goes to Google Drive', () => {
  it('skips GeM’s standard forms, also as an RA’s original-bid files', () => {
    expect(isGemStandardForm('GEM Availability Report ( GAR).pdf')).toBe(true);
    expect(isGemStandardForm('Original bid - Undertaking of Competent Authority is mandatory to create Custom Bid for Services.pdf')).toBe(true);
    expect(isGemStandardForm('Scope of Work.pdf')).toBe(false);
  });

  it('sends the bid documents and the eligibility sheet, and a file attached under three names once', () => {
    // As GeM bid GEM/2026/B/8118466 came: one PDF uploaded as three attachments.
    const folder = mkdtempSync(join(tmpdir(), 'ta-drive-select-'));
    const documents = join(folder, 'Documents');
    mkdirSync(documents);
    writeFileSync(join(folder, 'Eligibility.xlsx'), 'sheet');
    for (const name of ['Scope of Work.pdf', 'Service level agreement.pdf', 'services being proposed for procurement using custom bid functionality.pdf']) {
      writeFileSync(join(documents, name), 'the same scope document');
    }
    writeFileSync(join(documents, 'GeM bid GEM-2026-B-8118466.pdf'), 'bid');
    writeFileSync(join(documents, 'Instruction To Bidder.pdf'), 'instructions');
    writeFileSync(join(documents, 'GEM Availability Report ( GAR).pdf'), 'gar');
    writeFileSync(join(documents, 'Undertaking of Competent Authority is mandatory to create Custom Bid for Services.pdf'), 'form');

    expect([...filesForDrive(folder)].map((path) => path.slice(folder.length + 1).replace(/\\/g, '/')).sort()).toEqual([
      'Documents/GeM bid GEM-2026-B-8118466.pdf',
      'Documents/Instruction To Bidder.pdf',
      'Documents/Scope of Work.pdf',
      'Eligibility.xlsx',
    ]);
  });
});
