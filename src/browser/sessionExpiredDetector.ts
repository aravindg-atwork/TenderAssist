/**
 * The portal's own sign-in form (Login ID, Password, Captcha). Seen after
 * sign-in, it means the portal signed the operator out, for example after
 * the page crashed and was reloaded.
 */
export function isSignInPage(pageText: string): boolean {
  return /user\s*login/i.test(pageText) && /login\s*id/i.test(pageText) && /password/i.test(pageText) && /captcha/i.test(pageText);
}

export function isSessionExpiredPage(url: string, pageText: string): boolean {
  const urlMatches = url.includes('page=CommonErrorPage') || url.includes('page=NoAuthorizationPage');
  const textMatches = /session\s.{0,40}expired/is.test(pageText);
  return urlMatches || textMatches;
}
