// Website categories shared between every TenderAssist through the key server.
// When any office's search reads a website's category list, it is reported;
// every app pulls the latest lists (at start, hourly, and before a search), so
// a category the website renamed or dropped shows up everywhere the same day,
// even for offices that have not searched that website yet.

export interface SharedCategory {
  name: string;
  code: string;
  firstSeen: string;
  lastSeen: string;
  /** Set once a later read of the list no longer had it. */
  goneSince: string;
}

export interface SharedCategoryList {
  categories: SharedCategory[];
  /** The latest read any office made of this list. */
  readAt: string;
}

export interface CategoryChange { change: 'New' | 'Gone' | 'Back'; category: string }

interface Caller { serverUrl: string; key: string; pcId: string; fetch?: typeof fetch }

async function post<T>(caller: Caller, body: Record<string, unknown>): Promise<T | null> {
  if (!caller.serverUrl || !caller.key) return null;
  try {
    const response = await (caller.fetch ?? fetch)(caller.serverUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...body, key: caller.key, pcId: caller.pcId }),
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    const reply = await response.json() as T & { ok?: boolean };
    return reply.ok ? reply : null;
  } catch {
    return null;
  }
}

/** Every website's shared list, by the app's own list id (portal id, or GeM's product list id); null when the server cannot be reached. */
export async function fetchSharedCategories(caller: Caller): Promise<Record<string, SharedCategoryList> | null> {
  const reply = await post<{ portals?: Record<string, SharedCategoryList> }>(caller, { action: 'categories' });
  return reply?.portals ?? null;
}

/** Reports a list just read from the website. Returns what changed for everyone, or null when not taken (offline, older, or a half-loaded list). */
export async function reportCategoryList(
  caller: Caller, website: string, names: readonly string[], readAt: string, codes?: Record<string, string>,
): Promise<CategoryChange[] | null> {
  const list = names.map((name) => ({ name, code: codes?.[name] ?? '' }));
  const reply = await post<{ accepted?: boolean; changes?: CategoryChange[] }>(caller, { action: 'report-categories', website, list, readAt });
  return reply?.accepted ? reply.changes ?? [] : null;
}

/**
 * The shared list to take into this PC's own, when another office read the
 * website after this PC last did: the categories on that latest read, with
 * their codes. Null when this PC's own list is as new or newer.
 */
export function sharedListToApply(
  local: { readAt: string | null },
  shared: SharedCategoryList | undefined,
): { names: string[]; codes: Record<string, string>; readAt: string } | null {
  if (!shared?.readAt) return null;
  if (local.readAt && Date.parse(local.readAt) >= Date.parse(shared.readAt)) return null;
  const current = shared.categories.filter((category) => !category.goneSince && category.name);
  if (current.length === 0) return null;
  const codes: Record<string, string> = {};
  for (const category of current) if (category.code) codes[category.name] = category.code;
  return { names: current.map((category) => category.name), codes, readAt: shared.readAt };
}
