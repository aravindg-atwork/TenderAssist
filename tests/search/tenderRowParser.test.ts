import { describe, it, expect } from 'vitest';
import { parseTenderRow } from '../../src/search/tenderRowParser.js';

describe('parseTenderRow', () => {
  it('parses a real captured row with a long title and 3-level organisation chain', () => {
    const cells = [
      '1.',
      '11-Sep-2026 06:00 PM',
      '28-Sep-2026 11:00 AM',
      '29-Sep-2026 11:00 AM',
      '[Purchase of MATLAB with Simulink and Automotive related Tool Boxes for Establishment of Electric Vehicle Technology Laboratory in 3 Government Engineering Colleges at Tirunelveli, Dharmapuri and Erode] [GCE/TLY/5184/A2/2026][2026_DoTE_704004_1]',
      'Directorate of Technical Education||Govt. Engineering College - DOTE||Government College of Engineering - Tirunelveli',
    ];

    const parsed = parseTenderRow(cells);
    expect(parsed).toEqual({
      ePublishedDate: '11-Sep-2026 06:00 PM',
      closingDate: '28-Sep-2026 11:00 AM',
      openingDate: '29-Sep-2026 11:00 AM',
      title:
        'Purchase of MATLAB with Simulink and Automotive related Tool Boxes for Establishment of Electric Vehicle Technology Laboratory in 3 Government Engineering Colleges at Tirunelveli, Dharmapuri and Erode',
      tenderReferenceNumber: 'GCE/TLY/5184/A2/2026',
      tenderPortalId: '2026_DoTE_704004_1',
      organisationChain: [
        'Directorate of Technical Education',
        'Govt. Engineering College - DOTE',
        'Government College of Engineering - Tirunelveli',
      ],
    });
  });

  it('parses a real captured row with a short title and 3-level organisation chain', () => {
    const cells = [
      '2.',
      '10-Sep-2026 05:00 PM',
      '25-Sep-2026 03:00 PM',
      '28-Sep-2026 04:00 PM',
      '[Software] [BU/R-D2/Software/12131][2026_HE_703362_1]',
      'Higher Education||Bharathiar University||Registrars office',
    ];

    const parsed = parseTenderRow(cells);
    expect(parsed).toEqual({
      ePublishedDate: '10-Sep-2026 05:00 PM',
      closingDate: '25-Sep-2026 03:00 PM',
      openingDate: '28-Sep-2026 04:00 PM',
      title: 'Software',
      tenderReferenceNumber: 'BU/R-D2/Software/12131',
      tenderPortalId: '2026_HE_703362_1',
      organisationChain: ['Higher Education', 'Bharathiar University', 'Registrars office'],
    });
  });

  it('parses a real captured row with a 2-level organisation chain', () => {
    const cells = [
      '3.',
      '05-Sep-2026 03:00 PM',
      '01-Oct-2026 03:00 PM',
      '01-Oct-2026 03:30 PM',
      '[Empanelment of Software] [ANGADI-RC-IT02-2026-0020][2026_ELCO_701728_1]',
      'ELCOT||Procurement',
    ];

    const parsed = parseTenderRow(cells);
    expect(parsed?.title).toBe('Empanelment of Software');
    expect(parsed?.tenderReferenceNumber).toBe('ANGADI-RC-IT02-2026-0020');
    expect(parsed?.tenderPortalId).toBe('2026_ELCO_701728_1');
    expect(parsed?.organisationChain).toEqual(['ELCOT', 'Procurement']);
  });

  it('returns null when the row has fewer than 6 cells', () => {
    expect(parseTenderRow(['1.', 'only', 'four', 'cells'])).toBeNull();
  });

  it('returns null when the title cell does not match the [Title] [Ref][Id] pattern', () => {
    const cells = ['1.', 'x', 'x', 'x', 'not bracketed at all', 'Org'];
    expect(parseTenderRow(cells)).toBeNull();
  });
});
