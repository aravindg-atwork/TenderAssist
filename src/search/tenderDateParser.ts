const MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

// TN Tenders displays every date/time as DD-MMM-YYYY HH:MM AM/PM in IST
// (UTC+5:30), verified against the real portal. Encode the offset
// explicitly rather than assuming the machine's local timezone.
export function parseTenderPortalDate(raw: string): string | null {
  const match = raw.trim().match(/^(\d{2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;

  const [, day, monthAbbr, year, hourStr, minute, meridiemRaw] = match;
  const monthKey = monthAbbr[0].toUpperCase() + monthAbbr.slice(1, 3).toLowerCase();
  const month = MONTHS[monthKey];
  if (!month) return null;

  let hour = parseInt(hourStr, 10);
  const meridiem = meridiemRaw.toUpperCase();
  if (meridiem === 'PM' && hour !== 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;

  const hourPadded = String(hour).padStart(2, '0');
  return `${year}-${month}-${day}T${hourPadded}:${minute}:00+05:30`;
}
