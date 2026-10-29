// -----------------------------------------------------------------------------
// Calendar days, as a French school sees them.
//
// AppTable serves schools in France and Monaco: "today's menu" is the menu of
// the day in Paris, whatever time zone the container runs in (UTC, usually).
// Days are handled as plain `YYYY-MM-DD` strings: no Date object travels
// between modules, so no hidden time zone can shift a menu by one day.
// -----------------------------------------------------------------------------

import { pick } from './i18n.js';

export const TIME_ZONE = 'Europe/Paris';

// en-CA formats a date as YYYY-MM-DD.
const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const HOUR_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  hourCycle: 'h23',
});

/**
 * The day `offset` days after the current day in Paris.
 *
 * @param {Date} [now]
 * @param {number} [offset] days to add (1 = tomorrow)
 * @returns {string} YYYY-MM-DD
 */
export function localDay(now = new Date(), offset = 0) {
  return addDays(DAY_FORMAT.format(now), offset);
}

/** The hour (0-23) in Paris. */
export function localHour(now = new Date()) {
  return Number(HOUR_FORMAT.format(now));
}

/**
 * Add days to a YYYY-MM-DD day (computed at noon UTC: no DST edge).
 *
 * @param {string} day YYYY-MM-DD
 * @param {number} offset
 * @returns {string} YYYY-MM-DD
 */
export function addDays(day, offset) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/**
 * The day part of a date sent by the API. AppTable sends local dates without
 * an offset ("2026-11-02T00:00:00"): their first ten characters ARE the day.
 * Anything else is parsed and read in UTC, like the AppTable app does.
 *
 * @param {unknown} value
 * @returns {string|null} YYYY-MM-DD
 */
export function dayOf(value) {
  if (typeof value !== 'string') {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/.test(value)) {
    return value.slice(0, 10);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

/**
 * A day as a reader says it: "Monday 3 November", "lundi 3 novembre"…
 *
 * @param {string} day YYYY-MM-DD
 * @param {string} language
 */
export function formatDay(day, language) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(pick(language, LOCALES), {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}
