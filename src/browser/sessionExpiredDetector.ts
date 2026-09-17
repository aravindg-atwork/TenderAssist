export function isSessionExpiredPage(url: string, pageText: string): boolean {
  const urlMatches = url.includes('page=CommonErrorPage');
  const textMatches = /session\s.{0,40}expired/is.test(pageText);
  return urlMatches || textMatches;
}
