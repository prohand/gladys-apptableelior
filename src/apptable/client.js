// -----------------------------------------------------------------------------
// HTTP client of the AppTable API (apptable.elior.com), the one the AppTable
// web app and mobile apps use.
//
// How the official app talks to it, and so how we do:
//   - `client-settings.json`, served next to the web app, gives the API domain,
//     the public `api-key` header and the `X-Tenant-Key` header. Those values
//     are public (any browser downloads them) but they change when Elior
//     rotates them: they are read at startup, never copied into this code;
//   - `POST /api/v1/auth` with `{ email, password }` answers
//     `{ accessToken, refreshToken }`; the access token is a JWT sent as
//     `Authorization: Bearer`, renewed with `POST /api/v1/auth/refresh`;
//   - every data call is a POST, with a JSON body or none.
//
// Secrets: the password and the tokens never reach a log line.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'apptable' });

/** Where the web app lives, and where its settings file is served. */
export const APPTABLE_ORIGIN = 'https://apptable.elior.com';
export const CLIENT_SETTINGS_URL = `${APPTABLE_ORIGIN}/client-settings.json`;

export const PATHS = {
  LOGIN: '/api/v1/auth',
  REFRESH: '/api/v1/auth/refresh',
  ME: '/api/v1/user/me',
  CHILDREN: '/api/v1/user/get-convive-list',
  MENUS: '/api/v1/menus',
  CONSUMPTIONS: '/api/v1/convive-consommations',
  INVOICES: '/api/v1/factures',
};

/** A slow API must not hold a scene or a widget forever. */
const REQUEST_TIMEOUT_MS = 20_000;

/** Renew the access token this long before it expires. */
const TOKEN_MARGIN_MS = 60_000;

/** An error of the AppTable API, with its HTTP status (0 = no answer). */
export class AppTableError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'AppTableError';
    this.status = status;
  }
}

/** The account was refused: wrong email or password. Retrying will not help. */
export class AuthenticationError extends AppTableError {
  constructor(status) {
    super('AppTable refused the email or the password', status);
    this.name = 'AuthenticationError';
  }
}

/**
 * Expiry of a JWT, read from its payload (no signature check: we only want to
 * know when to renew it, the server stays the judge).
 *
 * @param {string} token
 * @returns {number|null} epoch milliseconds
 */
export function tokenExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Check and keep what the client needs from `client-settings.json`.
 *
 * @param {any} raw
 * @returns {{ apiDomain: string, apiKey: string, tenantKey: string }}
 */
export function parseClientSettings(raw) {
  const apiDomain = String(raw?.apiDomain ?? '').replace(/\/+$/, '');
  const apiKey = raw?.apiKey;
  const tenantKey = raw?.tenant?.key;
  // The bearer token goes to apiDomain: never anywhere but https.
  if (!/^https:\/\/[^/]+$/.test(apiDomain)) {
    throw new AppTableError('AppTable settings: unexpected API domain');
  }
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new AppTableError('AppTable settings: no API key');
  }
  if (typeof tenantKey !== 'string' || tenantKey.length === 0) {
    throw new AppTableError('AppTable settings: no tenant key');
  }
  return { apiDomain, apiKey, tenantKey };
}

export class AppTableClient {
  /**
   * @param {object} options
   * @param {string} options.email
   * @param {string} options.password
   * @param {typeof fetch} [options.fetch] injected by the tests
   * @param {() => number} [options.now]
   */
  constructor({ email, password, fetch: fetchImpl = globalThis.fetch, now = Date.now }) {
    this.email = email;
    this.password = password;
    this.fetch = fetchImpl;
    this.now = now;
    this.settings = null;
    this.token = null;
    // One login at a time: a widget and the refresh timer can ask together.
    this.authenticating = null;
  }

  async loadSettings() {
    if (!this.settings) {
      const response = await this.send(CLIENT_SETTINGS_URL, { method: 'GET' });
      this.settings = parseClientSettings(await readJson(response));
    }
    return this.settings;
  }

  headers({ bearer = true } = {}) {
    const headers = {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': this.settings.apiKey,
      'X-Tenant-Key': this.settings.tenantKey,
      // The official web app sends these three; the API uses them to tell its
      // clients apart.
      'X-Client-Platform': 'Web',
      'X-Client-Version': 'web',
      'X-Client-AppVersion': 'web',
    };
    if (bearer && this.token) {
      headers.authorization = `Bearer ${this.token.accessToken}`;
    }
    return headers;
  }

  /** `fetch` with a timeout, network errors turned into AppTableError. */
  async send(url, init) {
    try {
      return await this.fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      throw new AppTableError(`AppTable unreachable (${err.name ?? 'Error'})`);
    }
  }

  async post(path, body, options) {
    const settings = await this.loadSettings();
    return this.send(`${settings.apiDomain}${path}`, {
      method: 'POST',
      headers: this.headers(options),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  /** Log in with the email and the password. */
  async login() {
    logger.debug('Logging in to AppTable');
    const response = await this.post(
      PATHS.LOGIN,
      { email: this.email, password: this.password },
      { bearer: false },
    );
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw new AuthenticationError(response.status);
    }
    this.setToken(await readJson(response));
    logger.info('Logged in to AppTable');
  }

  /** Renew the access token; falls back to a fresh login when refused. */
  async refreshToken() {
    const response = await this.post(
      PATHS.REFRESH,
      { accessToken: this.token.accessToken, refreshToken: this.token.refreshToken },
      { bearer: false },
    );
    if (!response.ok) {
      logger.debug(`Token refresh refused (${response.status}), logging in again`);
      this.token = null;
      return this.login();
    }
    this.setToken(await readJson(response));
  }

  setToken(body) {
    if (typeof body?.accessToken !== 'string' || body.accessToken.length === 0) {
      throw new AppTableError('AppTable answered the login without a token');
    }
    this.token = {
      accessToken: body.accessToken,
      refreshToken: body.refreshToken ?? null,
      expiresAt: tokenExpiry(body.accessToken),
    };
  }

  /** Make sure a valid access token is held. */
  async authenticate({ force = false } = {}) {
    if (!this.authenticating) {
      this.authenticating = (async () => {
        const expired =
          this.token?.expiresAt != null && this.token.expiresAt - TOKEN_MARGIN_MS <= this.now();
        if (!this.token) {
          await this.login();
        } else if (force || expired) {
          if (this.token.refreshToken) {
            await this.refreshToken();
          } else {
            await this.login();
          }
        }
      })().finally(() => {
        this.authenticating = null;
      });
    }
    return this.authenticating;
  }

  /**
   * An authenticated call. A 401 renews the token once and retries: the server
   * can revoke a token before the expiry it carries.
   */
  async call(path, body) {
    await this.authenticate();
    let response = await this.post(path, body);
    if (response.status === 401) {
      await this.authenticate({ force: true });
      response = await this.post(path, body);
    }
    return readJson(response, path);
  }

  /** The account holder (name, user id). */
  me() {
    return this.call(PATHS.ME);
  }

  /** The children ("convives") attached to the account. */
  children() {
    return this.call(PATHS.CHILDREN);
  }

  /**
   * The menus of a restaurant and section around a day.
   *
   * @param {{ restaurantId: unknown, sectionId: unknown }} place
   * @param {string} day YYYY-MM-DD
   */
  menus({ restaurantId, sectionId }, day) {
    return this.call(PATHS.MENUS, { restaurantId, sectionId, selectedDate: `${day}T00:00:00` });
  }

  /** The meals booked for a child, day by day. */
  consumptions(billingId) {
    return this.call(PATHS.CONSUMPTIONS, { bonAppFacturationConviveId: billingId, month: null });
  }

  /** The invoices of the account, grouped by account holder. */
  invoices() {
    return this.call(PATHS.INVOICES);
  }
}

/** The JSON body of a response, or an AppTableError naming the status. */
async function readJson(response, what = 'request') {
  if (!response.ok) {
    throw new AppTableError(`AppTable ${what} failed (HTTP ${response.status})`, response.status);
  }
  const text = await response.text();
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AppTableError(`AppTable ${what}: the answer is not JSON`, response.status);
  }
}
