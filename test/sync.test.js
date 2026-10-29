import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppTableClient } from '../src/apptable/client.js';
import {
  createMenuCache,
  fetchSnapshot,
  menuGroups,
  menuOf,
  MENU_DAYS,
} from '../src/apptable/sync.js';
import { createFakeAppTable, menuOf as rawMenu } from './helpers/fakeAppTable.js';

// Monday 2 November 2026, 08:00 in Paris.
const NOW = new Date('2026-11-02T07:00:00Z');

function setup(state) {
  const server = createFakeAppTable(state);
  const client = new AppTableClient({
    email: 'p@example.com',
    password: 'secret',
    fetch: server.fetch,
  });
  let clock = NOW.getTime();
  const cache = createMenuCache({ now: () => clock });
  return {
    server,
    client,
    cache,
    advance: (ms) => (clock += ms),
    snapshot: () => fetchSnapshot(client, { cache, now: new Date(clock) }),
  };
}

test('two children with the same menu cost one menu request per day', async () => {
  const { server, snapshot } = setup({
    menus: { '501|7': [rawMenu('2026-11-02'), rawMenu('2026-11-03', ['Soupe', 'Poisson'])] },
  });
  const result = await snapshot();

  assert.equal(server.calls('/api/v1/menus').length, MENU_DAYS);
  assert.deepEqual(result.days, ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']);

  const [lea, tom] = result.children;
  assert.equal(menuOf(result, lea, '2026-11-02'), menuOf(result, tom, '2026-11-02'));
  assert.equal(menuOf(result, lea, '2026-11-04'), null);

  const [group] = menuGroups(result, '2026-11-02');
  assert.deepEqual(
    group.children.map((child) => child.firstName),
    ['Léa', 'Tom'],
  );
  assert.equal(menuGroups(result, '2026-11-02').length, 1);
});

test('children in different canteens get their own menu', async () => {
  const { server, snapshot } = setup({
    menus: { '501|7': [rawMenu('2026-11-02')], '777|3': [rawMenu('2026-11-02', ['Quiche'])] },
  });
  server.children[1].etablissement.restaurantId = 777;
  server.children[1].section.id = 3;
  const result = await snapshot();

  assert.equal(server.calls('/api/v1/menus').length, 2 * MENU_DAYS);
  const groups = menuGroups(result, '2026-11-02');
  assert.equal(groups.length, 2);
  assert.notEqual(groups[0].menu, groups[1].menu);
});

test('menus are cached for a few hours, bookings and invoices are not', async () => {
  const { server, snapshot, advance } = setup({ menus: { '501|7': [rawMenu('2026-11-02')] } });
  await snapshot();
  advance(60 * 60 * 1000);
  await snapshot();
  assert.equal(server.calls('/api/v1/menus').length, MENU_DAYS);
  assert.equal(server.calls('/api/v1/factures').length, 2);
  assert.equal(server.calls('/api/v1/convive-consommations').length, 4);

  advance(3 * 60 * 60 * 1000);
  await snapshot();
  assert.equal(server.calls('/api/v1/menus').length, 2 * MENU_DAYS);
});

test('bookings are read for today and tomorrow; a missing day is not booked', async () => {
  const { snapshot } = setup({ bookings: { 9011: { '2026-11-02': true } } });
  const result = await snapshot();
  assert.deepEqual(result.children[0].bookings, { '2026-11-02': true, '2026-11-03': false });
});

test('a failing part leaves the others', async () => {
  const { server, snapshot } = setup({ menus: { '501|7': [rawMenu('2026-11-02')] } });
  server.failures['/api/v1/factures'] = 500;
  server.failures['/api/v1/convive-consommations'] = 500;
  const result = await snapshot();
  assert.equal(result.invoices, null);
  // One child's bookings failed, the other's were read.
  const known = result.children.filter((child) => '2026-11-02' in child.bookings);
  assert.equal(known.length, 1);
  assert.ok(menuOf(result, result.children[0], '2026-11-02'));
});

test('a menu that could not be read is unknown, and asked again next time', async () => {
  const { server, snapshot } = setup({ menus: { '501|7': [rawMenu('2026-11-02')] } });
  server.failures['/api/v1/menus'] = 503;
  const first = await snapshot();
  const unknown = first.days.filter((day) => menuOf(first, first.children[0], day) === undefined);
  assert.equal(unknown.length, 1);

  await snapshot();
  assert.equal(server.calls('/api/v1/menus').length, MENU_DAYS + 1);
});

test('a child without billing id has no bookings read', async () => {
  const { server, snapshot } = setup();
  server.children[0].bonAppFacturationConviveId = null;
  const result = await snapshot();
  assert.deepEqual(result.children[0].bookings, {});
  assert.equal(server.calls('/api/v1/convive-consommations').length, 1);
});

test('without the children list nothing can be read', async () => {
  const { server, snapshot } = setup();
  server.failures['/api/v1/user/get-convive-list'] = 500;
  await assert.rejects(snapshot());
});
