import { describe, expect, it } from 'vitest';
import { SimilarityIndex, stem, tokenize } from '../../src/review/tenderSimilarity.js';

const APPROVED = [
  { id: 'a1', title: 'Design, Development and Maintenance of Official Website for District Collectorate, Tiruvallur' },
  { id: 'a2', title: 'Custom Bid for Services - Development of Mobile Application for Grievance Redressal', text: 'Android and iOS mobile application with admin web portal' },
  { id: 'a3', title: 'E-Tender for Development of Learning Management System (LMS) and e-Content for Anna University' },
  { id: 'a4', title: 'Supply of Desktop Computers and Printers to Government Schools' },
];

describe('tender words', () => {
  it('stems simple plurals and keeps words that only look plural', () => {
    expect(stem('applications')).toBe('application');
    expect(stem('agencies')).toBe('agency');
    expect(stem('websites')).toBe('website');
    expect(stem('classes')).toBe('class');
    expect(stem('status')).toBe('status');
    expect(stem('analysis')).toBe('analysis');
    expect(stem('gis')).toBe('gis');
  });

  it('drops joining words, tender boilerplate and numbers', () => {
    expect(tokenize('E-Tender for Supply of Services to the Department of Revenue, 2026-27')).toEqual(['revenue']);
    expect(tokenize('Custom Bid for Services - Development of Web Portals')).toEqual(['development', 'web', 'portal']);
  });
});

describe('similarity to approved tenders', () => {
  const index = new SimilarityIndex(APPROVED);

  it('finds the approved tender a new one is most like', () => {
    const match = index.match('Development of Mobile Applications for Citizen Grievance Monitoring');
    expect(match.similar[0]).toMatchObject({ id: 'a2' });
    expect(match.best).toBeGreaterThan(0.4);
    expect(match.best).toBeLessThanOrEqual(1);
  });

  it('scores a website tender like the approved website, and hardware like nothing of ours but the hardware', () => {
    expect(index.match('Revamping of Official Website of Tiruvallur District').similar[0].id).toBe('a1');
    const lms = index.match('Learning Management System for Tamil Nadu Skill Development Corporation');
    expect(lms.similar[0].id).toBe('a3');
    expect(index.match('Construction of Compound Wall at PHC Ponneri').best).toBe(0);
  });

  it('gives the same text a similarity of 1, and never matches a tender with itself', () => {
    expect(index.match(APPROVED[0].title).best).toBeCloseTo(1, 5);
    expect(index.match(APPROVED[0].title, { excludeId: 'a1' }).similar.map((tender) => tender.id)).not.toContain('a1');
  });

  it('names at most three, and a title approved twice once', () => {
    const twice = new SimilarityIndex([...APPROVED, { id: 'a5', title: APPROVED[0].title }]);
    const match = twice.match('Development of website, mobile application and LMS portal');
    expect(match.similar.length).toBeLessThanOrEqual(3);
    expect(new Set(match.similar.map((tender) => tender.title)).size).toBe(match.similar.length);
  });

  it('is empty without approved tenders or without words', () => {
    expect(new SimilarityIndex([]).match('Development of website')).toEqual({ best: 0, similar: [] });
    expect(index.match('Tender for supply 2026')).toEqual({ best: 0, similar: [] });
  });

  it('stays fast over thousands of approved tenders', () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({ id: `t${i}`, title: `Development of web portal number ${i} for district ${i % 38} agency ${i % 97}` }));
    const started = Date.now();
    const big = new SimilarityIndex(many);
    for (let i = 0; i < 200; i += 1) big.match(`Maintenance of web portal for district agency ${i}`);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
