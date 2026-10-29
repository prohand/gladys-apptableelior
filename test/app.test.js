import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createApp } from '../src/app.js';
import { createFakeAppTable, menuOf } from './helpers/fakeAppTable.js';

// Monday 2 November 2026, 08:00 in Paris.
const NOW = new Date('2026-11-02T07:00:00Z');

const SELECTOR = 'test-integration';
const child = (id, feature) => `ext:${SELECTOR}:child:${id}${feature ? `:${feature}` : ''}`;
const account = (feature) => `ext:${SELECTOR}:account:invoices:${feature}`;

/** The content a widget resolves, as Gladys receives it. */
async function widget(gladys, key, options) {
  const ack = await gladys.fake.widgetGet(key, options);
  assert.equal(ack.success, true, ack.error);
  return ack.data.content;
}

async function setup({
  config = { email: 'Parent@Example.com ', password: 'secret' },
  server: state,
} = {}) {
  const server = createFakeAppTable({
    menus: {
      '501|7': [menuOf('2026-11-02'), menuOf('2026-11-03', ['Soupe', 'Lasagnes', 'Pomme'])],
    },
    bookings: { 9011: { '2026-11-02': true, '2026-11-03': false }, 9012: { '2026-11-02': true } },
    invoices: [
      {
        titulaireId: 1,
        nbFacturesToPay: 1,
        factures: [{ id: 100, libelle: 'Septembre 2026', montant: 52.3, reglee: false }],
      },
    ],
    ...state,
  });
  const gladys = createFakeGladys({ config });
  const timers = [];
  const memoryFile = join(await mkdtemp(join(tmpdir(), 'apptable-')), 'state.json');
  const app = createApp(gladys, {
    fetch: server.fetch,
    memoryFile,
    now: () => NOW,
    setInterval: (fn, ms) => {
      const timer = { fn, ms };
      timers.push(timer);
      return timer;
    },
    clearInterval: (timer) => timers.splice(timers.indexOf(timer), 1),
  });
  return { server, gladys, app, timers, memoryFile };
}

test('connecting publishes one device per child and one for the invoices', async () => {
  const { gladys, server } = await setup();
  await gladys.connect();

  const names = gladys.fake.discoveredDevices.map((device) => device.name);
  assert.deepEqual(names, ['Cantine Léa', 'Cantine Tom', 'AppTable – Factures']);
  // The email is sent as the user meant it.
  assert.equal(server.calls('/api/v1/auth')[0].body.email, 'parent@example.com');
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('the states: bookings, menus of today and tomorrow, invoices', async () => {
  const { gladys } = await setup();
  await gladys.connect();
  const lastState = (id) => gladys.fake.lastState(id);

  assert.equal(lastState(child(11, 'booked-today')), 1);
  assert.equal(lastState(child(11, 'booked-tomorrow')), 0);
  assert.equal(lastState(child(12, 'booked-tomorrow')), 0);
  assert.equal(lastState(child(11, 'menu-today')), 'Carottes râpées, Poulet basquaise, Yaourt');
  assert.equal(lastState(child(12, 'menu-tomorrow')), 'Soupe, Lasagnes, Pomme');
  assert.equal(lastState(account('amount-due')), 52.3);
  assert.equal(lastState(account('invoices-to-pay')), 1);
});

test('a day without meal publishes a dash, a menu that failed publishes nothing', async () => {
  const { gladys, server } = await setup({ server: { menus: {} } });
  server.failures['/api/v1/menus'] = 500;
  await gladys.connect();
  const published = gladys.fake.states.map((state) => state.device_feature_external_id);
  // The first menu read (today) failed: its feature was not published at all.
  assert.ok(!published.includes(child(11, 'menu-today')));
  assert.equal(gladys.fake.lastState(child(11, 'menu-tomorrow')), '—');
});

test('every device is a cloud device', async () => {
  const { gladys } = await setup();
  await gladys.connect();
  const transports = gladys.fake.transports.flat();
  assert.ok(transports.length >= 3);
  assert.ok(transports.every((entry) => entry.transport === 'cloud'));
});

test('a refresh changing nothing sends no state', async () => {
  const { gladys, app } = await setup();
  await gladys.connect();
  const count = gladys.fake.states.length;
  await app.refresh();
  assert.equal(gladys.fake.states.length, count);
});

test('the refresh timer follows the configured interval', async () => {
  const { gladys, timers } = await setup({
    config: { email: 'p@example.com', password: 'secret', refresh_minutes: 30 },
  });
  await gladys.connect();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 30 * 60 * 1000);

  await gladys.fake.configUpdated({
    email: 'p@example.com',
    password: 'secret',
    refresh_minutes: 5,
  });
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 15 * 60 * 1000, 'the interval never goes under 15 minutes');
});

test('without credentials, the status asks for them and nothing is called', async () => {
  const { gladys, server } = await setup({ config: {} });
  await gladys.connect();
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /e-mail et le mot de passe/);
  assert.equal(server.requests.length, 0);
});

test('a wrong password is reported as such', async () => {
  const { gladys } = await setup({ config: { email: 'p@example.com', password: 'nope' } });
  await gladys.connect();
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /refused the email or the password/);
  const report = await gladys.fake.action('test_connection', {});
  assert.match(report.data.message.en, /refused/);
});

test('"Test the connection" names the children and the invoices', async () => {
  const { gladys } = await setup();
  await gladys.connect();
  const { data } = await gladys.fake.action('test_connection', {});
  const { message } = data;
  assert.equal(message.fr, 'Connecté à AppTable — 2 enfants : Léa, Tom, 1 facture(s) à payer.');
  assert.deepEqual(Object.keys(message).sort(), ['de', 'en', 'es', 'fr']);
});

test('the invoices known at the first start are not announced as new', async () => {
  const { gladys, memoryFile } = await setup();
  await gladys.connect();
  assert.equal(gladys.fake.sceneEvents.length, 0);
  const stored = JSON.parse(await readFile(memoryFile, 'utf8'));
  assert.deepEqual(stored.invoiceIds, ['100']);
});

test('a new invoice fires new_invoice once', async () => {
  const { gladys, server, app } = await setup();
  await gladys.connect();
  server.invoices[0].factures.push({
    id: 101,
    libelle: 'Octobre 2026',
    montant: 47.8,
    reglee: false,
    datePeriodeFacture: '2026-10-01T00:00:00',
  });
  await app.refresh();
  await app.refresh();

  const events = gladys.fake.sceneEvents.filter((event) => event.key === 'new_invoice');
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].data, {
    label: 'Octobre 2026',
    amount: 47.8,
    period: '2026-10',
    paid: false,
  });
});

test('a booking cancelled by someone else fires booking_changed', async () => {
  const { gladys, server, app } = await setup();
  await gladys.connect();
  server.bookings[9011]['2026-11-02'] = false;
  await app.refresh();

  const events = gladys.fake.sceneEvents.filter((event) => event.key === 'booking_changed');
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].data, {
    device: child(11),
    child_name: 'Léa',
    when: 'today',
    change: 'cancelled',
    date: '2026-11-02',
  });
  assert.equal(gladys.fake.lastState(child(11, 'booked-today')), 0);
});

test('scene action get_menu reads the menu of a child', async () => {
  const { gladys } = await setup();
  await gladys.connect();
  const today = await gladys.fake.sceneAction('get_menu', { device: child(12), day: 'today' });
  assert.deepEqual(today.data.outputs, {
    menu: 'Carottes râpées, Poulet basquaise, Yaourt',
    has_menu: true,
    date: '2026-11-02',
    booked: true,
    child_name: 'Tom',
  });
  const tomorrow = await gladys.fake.sceneAction('get_menu', {
    device: child(11),
    day: 'tomorrow',
  });
  assert.equal(tomorrow.data.outputs.menu, 'Soupe, Lasagnes, Pomme');
});

test('scene action get_menu on the invoices device fails with a clear message', async () => {
  const { gladys } = await setup();
  await gladys.connect();
  const result = await gladys.fake.sceneAction('get_menu', {
    device: `ext:${SELECTOR}:account:invoices`,
  });
  assert.equal(result.success, false);
  assert.match(result.error, /child/);
});

test('scene action refresh returns the counts', async () => {
  const { gladys } = await setup();
  await gladys.connect();
  const result = await gladys.fake.sceneAction('refresh', {});
  assert.deepEqual(result.data.outputs, { children: 2, amount_due: 52.3, invoices_to_pay: 1 });
});

test('the menu widget shows the shared menu once, with every child', async () => {
  const { gladys } = await setup();
  await gladys.connect();
  const content = await widget(gladys, 'menu', { settings: { day: 'today' }, language: 'fr' });
  assert.deepEqual(validateWidgetContent(content), []);

  assert.equal(content.components[0].text, 'Lundi 2 novembre');
  const list = content.components.find((component) => component.type === 'card-list');
  assert.deepEqual(
    list.items.map((item) => item.title),
    ['Carottes râpées', 'Poulet basquaise', 'Yaourt'],
  );
  const status = content.components.find((component) => component.type === 'status');
  assert.deepEqual(
    status.items.map((item) => item.label),
    ['Léa', 'Tom'],
  );
});

test('the menu widget gives one row per menu when the children eat apart', async () => {
  const { gladys, server } = await setup();
  server.children[1].etablissement.restaurantId = 777;
  server.menus['777|7'] = [menuOf('2026-11-02', ['Quiche', 'Riz', 'Kiwi'])];
  await gladys.connect();
  const content = await widget(gladys, 'menu', { settings: { day: 'today' }, language: 'en' });
  assert.deepEqual(validateWidgetContent(content), []);
  const list = content.components.find((component) => component.type === 'card-list');
  assert.deepEqual(
    list.items.map((item) => [item.title, item.subtitle]),
    [
      ['Léa', 'Carottes râpées, Poulet basquaise, Yaourt'],
      ['Tom', 'Quiche, Riz, Kiwi'],
    ],
  );
});

test('the account widget is valid and its button refreshes', async () => {
  const { gladys, server } = await setup();
  await gladys.connect();
  const content = await widget(gladys, 'account', { language: 'de' });
  assert.deepEqual(validateWidgetContent(content), []);
  const tiles = content.components.filter((component) => component.type === 'value');
  assert.deepEqual(
    tiles.map((tile) => tile.device_feature),
    [account('amount-due'), account('invoices-to-pay')],
  );

  const before = server.calls('/api/v1/factures').length;
  const result = await gladys.fake.widgetAction('account', 'refresh', {}, {});
  assert.equal(result.success, true);
  assert.equal(server.calls('/api/v1/factures').length, before + 1);
});

test('widgets before any refresh say the account is not connected', async () => {
  const { gladys } = await setup({ config: {} });
  await gladys.connect();
  for (const key of ['menu', 'account']) {
    const content = await widget(gladys, key, { language: 'fr' });
    assert.deepEqual(validateWidgetContent(content), []);
    assert.match(content.components[0].text.fr, /Pas encore connecté/);
  }
});

test('the password and the tokens never reach the logs', async (t) => {
  const lines = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    t.mock.method(console, method, (...args) => lines.push(args.join(' ')));
  }
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'debug';
  try {
    const { gladys, app } = await setup();
    await gladys.connect();
    await app.refresh();
  } finally {
    if (previous === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = previous;
    }
  }
  const all = lines.join('\n');
  assert.ok(lines.length > 0);
  assert.doesNotMatch(all, /secret/);
  assert.doesNotMatch(all, /Bearer|refresh-1/);
});

test('a reconnection keeps the session and still sees booking changes', async () => {
  const { gladys, server } = await setup();
  await gladys.connect();
  await gladys.disconnect();
  server.bookings[9012]['2026-11-02'] = false;
  await gladys.connect();

  assert.equal(server.calls('/api/v1/auth').length, 1);
  const events = gladys.fake.sceneEvents.filter((event) => event.key === 'booking_changed');
  assert.deepEqual(
    events.map((event) => [event.data.child_name, event.data.change]),
    [['Tom', 'cancelled']],
  );
});

test('another account forgets the previous data', async () => {
  const { gladys, server } = await setup();
  await gladys.connect();
  server.password = 'other';
  await gladys.fake.configUpdated({ email: 'other@example.com', password: 'other' });
  assert.equal(server.calls('/api/v1/auth').length, 2);
  // Same menus, but asked again: the cache belonged to the other account.
  assert.equal(server.calls('/api/v1/menus').length, 8);
});

test('states refused by Gladys do not cost the scene events', async (t) => {
  const { gladys, server, app } = await setup();
  await gladys.connect();
  server.bookings[9011]['2026-11-03'] = true;
  t.mock.method(gladys, 'publishChangedStates', async () => {
    throw new Error('429 TOO_MANY_REQUESTS');
  });
  await app.refresh();
  const events = gladys.fake.sceneEvents.filter((event) => event.key === 'booking_changed');
  assert.equal(events.length, 1);
  assert.equal(events[0].data.change, 'booked');
});
