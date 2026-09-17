export function isSessionExpiredPage(url: string, pageText: string): boolean {
  const urlMatches = url.includes('page=CommonErrorPage');
  const textMatches = /session .{0,40}expired/i.test(pageText);
  return urlMatches || textMatches;
}
