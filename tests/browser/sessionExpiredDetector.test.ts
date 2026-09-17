import { describe, it, expect } from 'vitest';
import { isSessionExpiredPage } from '../../src/browser/sessionExpiredDetector.js';

describe('isSessionExpiredPage', () => {
  it('returns true when the URL contains page=CommonErrorPage', () => {
    const url = 'https://tntenders.gov.in/nicgep/app?page=CommonErrorPage&service=direct';
    expect(isSessionExpiredPage(url, 'Some error occurred')).toBe(true);
  });

  it('returns true when the page text says the session expired, even with a normal URL', () => {
    const url = 'https://tntenders.gov.in/nicgep/app?page=WebTenderStatusLists';
    const text = 'Your session in the client area has expired. Please login again.';
    expect(isSessionExpiredPage(url, text)).toBe(true);
  });

  it('returns false for a normal authenticated page with no error indicators', () => {
    const url = 'https://tntenders.gov.in/nicgep/app?page=WebTenderStatusLists';
    const text = 'Welcome : contractor@example.com\nBid Management\nLogout';
    expect(isSessionExpiredPage(url, text)).toBe(false);
  });

  it('returns false for empty inputs', () => {
    expect(isSessionExpiredPage('', '')).toBe(false);
  });

  it('is case-insensitive for the page text match', () => {
    const url = 'https://tntenders.gov.in/nicgep/app?page=WebTenderStatusLists';
    const text = 'YOUR SESSION IN THE CLIENT AREA HAS EXPIRED';
    expect(isSessionExpiredPage(url, text)).toBe(true);
  });

  it('returns true when a newline appears within the matched gap (innerText-extracted text)', () => {
    const url = 'https://tntenders.gov.in/nicgep/app?page=WebTenderStatusLists';
    const text = 'Your session in the client area\nhas expired.';
    expect(isSessionExpiredPage(url, text)).toBe(true);
  });
});
