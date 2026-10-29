import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, dayOf, formatDay, localDay, localHour } from '../src/dates.js';

test('the day is the day in Paris, not in UTC', () => {
  // 23:30 UTC on 1 November is 00:30 on 2 November in Paris (winter time).
  const late = new Date('2026-11-01T23:30:00Z');
  assert.equal(localDay(late), '2026-11-02');
  assert.equal(localDay(late, 1), '2026-11-03');
  assert.equal(localHour(late), 0);
  // Summer time: 22:30 UTC on 30 June is 00:30 on 1 July.
  assert.equal(localDay(new Date('2026-06-30T22:30:00Z')), '2026-07-01');
});

test('adding days crosses months, years and DST changes', () => {
  assert.equal(addDays('2026-10-24', 2), '2026-10-26');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2027-03-01', -1), '2027-02-28');
});

test('API dates without offset keep their day', () => {
  assert.equal(dayOf('2026-11-02T00:00:00'), '2026-11-02');
  assert.equal(dayOf('2026-11-02'), '2026-11-02');
  assert.equal(dayOf('2026-11-02T00:00:00Z'), '2026-11-02');
  assert.equal(dayOf('2026-11-02T00:00:00+01:00'), '2026-11-01');
  assert.equal(dayOf(''), null);
  assert.equal(dayOf(42), null);
});

test('a day reads in the reader language', () => {
  assert.equal(formatDay('2026-11-02', 'fr'), 'lundi 2 novembre');
  assert.equal(formatDay('2026-11-02', 'en'), 'Monday 2 November');
  assert.equal(formatDay('2026-11-02', 'de'), 'Montag, 2. November');
  assert.equal(formatDay('2026-11-02', 'es'), 'lunes, 2 de noviembre');
  assert.equal(formatDay('2026-11-02', 'it'), 'Monday 2 November');
});
