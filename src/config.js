// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys, from the `config_schema` of
// `gladys-assistant-integration.json`. This module only holds the defaults and
// normalizes what Gladys sends, so the rest of the code never deals with
// `undefined` or with numbers typed as strings.
// -----------------------------------------------------------------------------

/** Bounds of the refresh interval, in minutes (same as the manifest). */
export const REFRESH_BOUNDS = { min: 15, max: 1440 };

// Defaults: they MUST stay equal to the `default` values of the manifest
// `config_schema` (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  email: '',
  password: '',
  // AppTable data moves slowly (menus are published weeks ahead, invoices once
  // a month): one refresh an hour is plenty and keeps us a polite API client.
  refresh_minutes: 60,
  debug_logs: false,
};

/**
 * Merge the user config with the defaults and force the types.
 *
 * @param {Record<string, unknown>} raw config returned by the SDK
 * @returns {typeof DEFAULT_CONFIG}
 */
export function normalizeConfig(raw = {}) {
  const minutes = Number(raw.refresh_minutes ?? DEFAULT_CONFIG.refresh_minutes);
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    // An email is case-insensitive and often pasted with a trailing space.
    email: String(raw.email ?? '')
      .trim()
      .toLowerCase(),
    // A password is kept as typed: a space can be part of it.
    password: String(raw.password ?? ''),
    refresh_minutes: Number.isFinite(minutes)
      ? Math.min(REFRESH_BOUNDS.max, Math.max(REFRESH_BOUNDS.min, Math.round(minutes)))
      : DEFAULT_CONFIG.refresh_minutes,
    debug_logs: raw.debug_logs === true,
  };
}

/** Whether the account fields are filled in (nothing to log in with otherwise). */
export function hasCredentials(config) {
  return config.email.length > 0 && config.password.length > 0;
}

// The SDK logger re-reads LOG_LEVEL on every line: writing it is enough to
// switch the level at once, the SDK's own connection logs included. The value
// the container was started with is the baseline we go back to.
const BASELINE_LOG_LEVEL = process.env.LOG_LEVEL;

/** Apply the `debug_logs` switch of the Configuration screen. */
export function applyLogLevel(config) {
  const wanted = config.debug_logs ? 'debug' : BASELINE_LOG_LEVEL;
  if (wanted === undefined) {
    delete process.env.LOG_LEVEL;
  } else {
    process.env.LOG_LEVEL = wanted;
  }
}
