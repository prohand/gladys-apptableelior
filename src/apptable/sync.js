// -----------------------------------------------------------------------------
// One refresh of everything AppTable knows: children, menus, bookings,
// invoices — gathered into a "snapshot" the devices, the scenes and the widgets
// all read. Nothing else calls the API on a schedule.
//
// Menus are fetched per MENU, not per child: two children in the same
// restaurant and section eat the same meal, so they share one request, one
// cached answer, and the widget shows that menu once with both first names.
// The cache keeps a menu a few hours (they are published weeks ahead), so a
// refresh mostly costs the bookings and invoices calls.
//
// Each part fails on its own: an account without online billing still gets its
// menus, a menu that cannot be read leaves the others.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { addDays, localDay } from '../dates.js';
import { menuKey, parseBookings, parseChildren, parseInvoices, parseMenu } from './parse.js';

const logger = createLogger({ name: 'sync' });

/** Days of menus read from today: today, tomorrow, and up to the next Monday. */
export const MENU_DAYS = 4;

/** How long a fetched menu is kept before asking again. */
export const MENU_CACHE_MS = 3 * 60 * 60 * 1000;

/**
 * Create the menu cache: key (restaurant|section|day) -> { menu, at }.
 * A failed read is not cached: the next refresh tries again.
 */
export function createMenuCache({ now = Date.now } = {}) {
  const entries = new Map();
  return {
    get(key) {
      const entry = entries.get(key);
      return entry && now() - entry.at < MENU_CACHE_MS ? entry : undefined;
    },
    set(key, menu) {
      entries.set(key, { menu, at: now() });
    },
    clear() {
      entries.clear();
    },
  };
}

/**
 * Read everything once.
 *
 * @param {import('./client.js').AppTableClient} client
 * @param {object} options
 * @param {ReturnType<typeof createMenuCache>} options.cache
 * @param {Date} [options.now]
 * @returns {Promise<Snapshot>}
 *
 * @typedef {object} Snapshot
 * @property {string} fetchedAt ISO date
 * @property {string[]} days the days covered, today first
 * @property {Array<object>} children see parseChildren, plus `menus`
 *   (day -> menu key) and `bookings` (day -> boolean, absent = unknown)
 * @property {Map<string, object|null>} menus menu key -> menu (null = none
 *   served); a key absent from the map could not be read
 * @property {ReturnType<typeof parseInvoices>|null} invoices null = unknown
 */
export async function fetchSnapshot(client, { cache, now = new Date() }) {
  const today = localDay(now);
  const days = Array.from({ length: MENU_DAYS }, (_, offset) => addDays(today, offset));

  // The children list is the one call nothing works without: let it throw.
  const children = parseChildren(await client.children());

  const menus = new Map();
  const reads = new Map();
  for (const child of children) {
    child.menus = {};
    for (const day of days) {
      const key = menuKey(child, day);
      child.menus[day] = key;
      if (key !== null && !reads.has(key)) {
        reads.set(key, readMenu(client, cache, child, day, key, menus));
      }
    }
  }

  const bookings = children.map(async (child) => {
    child.bookings = {};
    if (child.billingId === null) {
      return;
    }
    try {
      const byDay = parseBookings(await client.consumptions(child.billingId));
      for (const day of days.slice(0, 2)) {
        // A day absent from the list is a day with nothing to book (holidays,
        // weekend): nothing booked, as the app shows it.
        child.bookings[day] = byDay.get(day) ?? false;
      }
    } catch (err) {
      logger.warn(`Bookings of child ${child.id} unavailable: ${err.message}`);
    }
  });

  const invoices = client.invoices().then(parseInvoices, (err) => {
    logger.warn(`Invoices unavailable: ${err.message}`);
    return null;
  });

  await Promise.all([...reads.values(), ...bookings]);
  return { fetchedAt: now.toISOString(), days, children, menus, invoices: await invoices };
}

async function readMenu(client, cache, child, day, key, menus) {
  const cached = cache.get(key);
  if (cached) {
    menus.set(key, cached.menu);
    return;
  }
  try {
    const menu = parseMenu(await client.menus(child, day), day);
    cache.set(key, menu);
    menus.set(key, menu);
  } catch (err) {
    logger.warn(`Menu ${key} unavailable: ${err.message}`);
  }
}

/** The menu of a child on a day: the menu, null (none served) or undefined (unknown). */
export function menuOf(snapshot, child, day) {
  const key = child.menus?.[day];
  if (key === null) {
    return null;
  }
  return key === undefined ? undefined : snapshot.menus.get(key);
}

/**
 * The children grouped by the menu they share on a day: one entry per menu,
 * in the order of the children list.
 *
 * @returns {Array<{ key: string, menu: object|null|undefined, children: object[] }>}
 */
export function menuGroups(snapshot, day) {
  const groups = new Map();
  for (const child of snapshot.children) {
    const key = child.menus?.[day];
    if (key === null || key === undefined) {
      continue;
    }
    if (!groups.has(key)) {
      groups.set(key, { key, menu: snapshot.menus.get(key), children: [] });
    }
    groups.get(key).children.push(child);
  }
  return [...groups.values()];
}
