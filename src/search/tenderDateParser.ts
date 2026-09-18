const MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

// The fixed IST offset (+05:30), in milliseconds, used to validate assembled
// timestamps below. Adding it to a UTC epoch-ms value yields a Date whose
// UTC* getters read back the original IST wall-clock components.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

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
  const iso = `${year}-${month}-${day}T${hourPadded}:${minute}:00+05:30`;

  // Date.parse validates syntax but not semantics: it silently rolls
  // impossible calendar dates forward (e.g. 31-Feb -> Mar 3) and can also
  // return NaN for out-of-range hour/minute values. Round-trip through the
  // known IST offset and confirm the calendar date we intended is the one
  // that comes back, rejecting both failure modes as malformed input.
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const shifted = new Date(ms + IST_OFFSET_MS);
  const roundTrippedDate =
    `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
  if (roundTrippedDate !== `${year}-${month}-${day}`) return null;

  return iso;
}
