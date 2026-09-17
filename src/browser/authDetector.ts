export function isAuthenticatedDashboard(pageText: string): boolean {
  const hasWelcome = /Welcome\s*:\s*\S+/.test(pageText);
  const hasLogout = pageText.includes('Logout');
  const hasBidManagement = pageText.includes('Bid Management');
  return hasWelcome && hasLogout && hasBidManagement;
}
