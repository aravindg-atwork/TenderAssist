import { describe, expect, it } from 'vitest';
import { chooseDriveFolder, pickerPage, projectNumberOf } from '../../src/publishing/drivePicker.js';

const page = { apiKey: 'AIza-key', appId: '859686513069', accessToken: 'ya29.token' };

/** Stands in for the browser: loads the page, then answers as the folder chooser would. */
const browserAnswering = (answer: unknown) => async (url: string) => {
  const html = await (await fetch(url)).text();
  expect(html).toContain('ya29.token');
  const answerPath = /const answer = "([^"]+)"/.exec(html)![1];
  await fetch(new URL(answerPath, url), { method: 'POST', body: JSON.stringify(answer) });
};

describe('choosing the Drive folder in Google’s folder chooser', () => {
  it('takes the Google Cloud project number from the client id', () => {
    expect(projectNumberOf('859686513069-74sjji9jq9j9o9qvduapjp14p0iof21j.apps.googleusercontent.com')).toBe('859686513069');
    expect(projectNumberOf('abc.apps.googleusercontent.com')).toBe('');
  });

  it('offers My Drive, folders shared with the operator, and shared drives', () => {
    const html = pickerPage({ ...page, answerPath: '/n/answer' });
    expect(html).toContain("setLabel('My Drive')");
    expect(html).toContain("setLabel('Shared with me')");
    expect(html).toContain('setEnableDrives(true)');
    expect(html).toContain('SUPPORT_DRIVES');
    expect(html).toContain('const appId = "859686513069"');
  });

  it('never lets a value end the page’s script', () => {
    const html = pickerPage({ ...page, accessToken: '</script><script>alert(1)</script>', answerPath: '/n/answer' });
    expect(html).not.toContain('</script><script>alert(1)');
  });

  it('returns the folder the operator picked', async () => {
    await expect(chooseDriveFolder(page, browserAnswering({ id: 'FOLDER1', name: 'Office Tenders' }))).resolves.toEqual({ id: 'FOLDER1', name: 'Office Tenders' });
  });

  it('returns nothing when the operator closes the chooser', async () => {
    await expect(chooseDriveFolder(page, browserAnswering({ cancelled: true }))).resolves.toBeNull();
  });

  it('says what went wrong when Google could not be reached', async () => {
    await expect(chooseDriveFolder(page, browserAnswering({ error: 'Google could not be reached.' }))).rejects.toThrow('Google could not be reached.');
  });

  it('gives up when nobody chooses in time', async () => {
    await expect(chooseDriveFolder(page, async () => {}, { timeoutMs: 50 })).rejects.toThrow('No folder was chosen in time');
  });
});
