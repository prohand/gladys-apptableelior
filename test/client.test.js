import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AppTableClient,
  AppTableError,
  AuthenticationError,
  parseClientSettings,
  tokenExpiry,
} from '../src/apptable/client.js';
import { createFakeAppTable, jwt, SETTINGS } from './helpers/fakeAppTable.js';

function clientFor(server, password = 'secret') {
  return new AppTableClient({ email: 'parent@example.com', password, fetch: server.fetch });
}

test('the settings of the web app give the domain and the public keys', () => {
  assert.deepEqual(parseClientSettings(SETTINGS), {
    apiDomain: 'https://api.apptable.test',
    apiKey: 'public-api-key',
    tenantKey: 'tenant-key',
  });
  assert.equal(
    parseClientSettings({ ...SETTINGS, apiDomain: 'https://x.test/' }).apiDomain,
    'https://x.test',
  );
});

test('a settings file that would send the token elsewhere than https is refused', () => {
  for (const apiDomain of ['http://api.apptable.test', 'https://x.test/path', '']) {
    assert.throws(() => parseClientSettings({ ...SETTINGS, apiDomain }), AppTableError);
  }
  assert.throws(() => parseClientSettings({ ...SETTINGS, apiKey: '' }), AppTableError);
  assert.throws(() => parseClientSettings({ ...SETTINGS, tenant: null }), AppTableError);
});

test('the expiry of a token is read from its payload', () => {
  assert.equal(tokenExpiry(jwt(1_800_000_000)), 1_800_000_000_000);
  assert.equal(tokenExpiry('garbage'), null);
});

test('calls carry the headers of the web app and the bearer token', async () => {
  const server = createFakeAppTable();
  const children = await clientFor(server).children();
  assert.equal(children.length, 2);

  const [login] = server.calls('/api/v1/auth');
  assert.deepEqual(login.body, { email: 'parent@example.com', password: 'secret' });
  assert.equal(login.headers.authorization, undefined);

  const [call] = server.calls('/api/v1/user/get-convive-list');
  assert.equal(call.method, 'POST');
  assert.equal(call.headers['api-key'], 'public-api-key');
  assert.equal(call.headers['X-Tenant-Key'], 'tenant-key');
  assert.equal(call.headers['X-Client-Platform'], 'Web');
  assert.match(call.headers.authorization, /^Bearer /);
});

test('the settings file and the login are read once', async () => {
  const server = createFakeAppTable();
  const client = clientFor(server);
  await Promise.all([client.children(), client.invoices(), client.children()]);
  assert.equal(server.calls('/client-settings.json').length, 1);
  assert.equal(server.calls('/api/v1/auth').length, 1);
});

test('a wrong password is an AuthenticationError', async () => {
  const server = createFakeAppTable();
  await assert.rejects(clientFor(server, 'wrong').children(), AuthenticationError);
});

test('a 401 renews the token once and retries the call', async () => {
  const server = createFakeAppTable();
  const client = clientFor(server);
  await client.children();
  server.failures['/api/v1/user/get-convive-list'] = 401;
  const children = await client.children();
  assert.equal(children.length, 2);
  assert.equal(server.calls('/api/v1/auth/refresh').length, 1);
});

test('an expired token is renewed before the call', async () => {
  const server = createFakeAppTable({ tokenExp: Math.floor(Date.now() / 1000) + 30 });
  const client = clientFor(server);
  await client.children();
  await client.children();
  // 30 s left is under the renewal margin: renewed before the second call.
  assert.equal(server.calls('/api/v1/auth/refresh').length, 1);
});

test('a refused refresh falls back to a fresh login', async () => {
  const server = createFakeAppTable({ tokenExp: Math.floor(Date.now() / 1000) + 30 });
  const client = clientFor(server);
  await client.children();
  server.failures['/api/v1/auth/refresh'] = 400;
  await client.children();
  assert.equal(server.calls('/api/v1/auth').length, 2);
});

test('an HTTP error names the call and the status', async () => {
  const server = createFakeAppTable();
  server.failures['/api/v1/factures'] = 500;
  await assert.rejects(clientFor(server).invoices(), (err) => {
    assert.ok(err instanceof AppTableError);
    assert.equal(err.status, 500);
    assert.match(err.message, /\/api\/v1\/factures failed \(HTTP 500\)/);
    return true;
  });
});

test('a network failure is an AppTableError, without the password', async () => {
  const client = new AppTableClient({
    email: 'parent@example.com',
    password: 'secret',
    fetch: async () => {
      throw new TypeError('fetch failed');
    },
  });
  await assert.rejects(client.children(), (err) => {
    assert.ok(err instanceof AppTableError);
    assert.doesNotMatch(err.message, /secret/);
    return true;
  });
});

test('the menu request names the restaurant, the section and the day', async () => {
  const server = createFakeAppTable();
  await clientFor(server).menus({ restaurantId: 501, sectionId: 7 }, '2026-11-02');
  const [call] = server.calls('/api/v1/menus');
  assert.deepEqual(call.body, {
    restaurantId: 501,
    sectionId: 7,
    selectedDate: '2026-11-02T00:00:00',
  });
});
