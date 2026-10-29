// -----------------------------------------------------------------------------
// The integration, wired to a Gladys client.
//
// index.js passes the real SDK client; the tests pass the fake Gladys of the
// SDK and a fake `fetch`. Everything the integration does starts here:
//
//   connected / config updated -> log in, refresh, (re)arm the refresh timer
//   timer tick                 -> refresh
//   refresh                    -> devices (when the children changed), states
//                                 (only the changed ones), scene events,
//                                 transport badges, connection status, widgets
//
// One refresh at a time: a widget button, a scene and the timer asking
// together share the same run.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { AppTableClient, AuthenticationError } from './apptable/client.js';
import { createMenuCache, fetchSnapshot } from './apptable/sync.js';
import { applyLogLevel, hasCredentials, normalizeConfig } from './config.js';
import { localize, pick } from './i18n.js';
import { loadMemory } from './memory.js';
import { buildDiscoveredDevices, statesOf, transportsOf } from './devices/index.js';
import { detectEvents, publishEvents, sceneActionHandlers } from './capabilities/scenes.js';
import { refreshWidgets, widgetHandlers } from './capabilities/widgets.js';

const logger = createLogger({ name: 'app' });

/** Keys of the manifest `actions`. */
export const ACTIONS = { TEST_CONNECTION: 'test_connection' };

/** Re-send unchanged states this often, so they stay recently dated in Gladys. */
const STATE_HEARTBEAT_MS = 6 * 60 * 60 * 1000;

const MESSAGES = {
  missingCredentials: {
    en: 'Enter the email and password of your AppTable account.',
    fr: 'Renseignez l’e-mail et le mot de passe de votre compte AppTable.',
    de: 'Gib die E-Mail-Adresse und das Passwort deines AppTable-Kontos ein.',
    es: 'Introduzca el correo y la contraseña de su cuenta de AppTable.',
  },
  refused: {
    en: 'AppTable refused the email or the password.',
    fr: 'AppTable a refusé l’e-mail ou le mot de passe.',
    de: 'AppTable hat E-Mail oder Passwort abgelehnt.',
    es: 'AppTable ha rechazado el correo o la contraseña.',
  },
  unreachable: {
    en: 'AppTable cannot be reached right now, the integration will try again.',
    fr: 'AppTable est injoignable pour le moment, l’intégration réessaiera.',
    de: 'AppTable ist gerade nicht erreichbar, die Integration versucht es erneut.',
    es: 'AppTable no está disponible por ahora, la integración lo volverá a intentar.',
  },
};

/** The message of a failed refresh, for the Configuration screen. */
export function failureMessage(err) {
  return err instanceof AuthenticationError ? MESSAGES.refused : MESSAGES.unreachable;
}

/** The answer of "Test the connection", in every language. */
export function connectionReport(snapshot) {
  const count = snapshot.children.length;
  const names = snapshot.children.map((child) => child.firstName).join(', ');
  return localize((language) => {
    const children = pick(language, {
      en: count === 0 ? 'no child found' : `${count} child${count > 1 ? 'ren' : ''}: ${names}`,
      fr: count === 0 ? 'aucun enfant trouvé' : `${count} enfant${count > 1 ? 's' : ''} : ${names}`,
      de: count === 0 ? 'kein Kind gefunden' : `${count} Kind${count > 1 ? 'er' : ''}: ${names}`,
      es: count === 0 ? 'ningún niño encontrado' : `${count} niño${count > 1 ? 's' : ''}: ${names}`,
    });
    const invoices = snapshot.invoices
      ? pick(language, {
          en: `${snapshot.invoices.toPay} invoice(s) to pay`,
          fr: `${snapshot.invoices.toPay} facture(s) à payer`,
          de: `${snapshot.invoices.toPay} offene Rechnung(en)`,
          es: `${snapshot.invoices.toPay} factura(s) a pagar`,
        })
      : pick(language, {
          en: 'invoices unavailable',
          fr: 'factures indisponibles',
          de: 'Rechnungen nicht verfügbar',
          es: 'facturas no disponibles',
        });
    const ok = pick(language, {
      en: 'Connected to AppTable',
      fr: 'Connecté à AppTable',
      de: 'Mit AppTable verbunden',
      es: 'Conectado a AppTable',
    });
    return `${ok} — ${children}, ${invoices}.`;
  });
}

/**
 * Register every handler of the integration on a Gladys client.
 *
 * @param {object} gladys a GladysIntegration (or the SDK fake)
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch]
 * @param {string} [options.memoryFile]
 * @param {() => Date} [options.now]
 * @param {typeof setInterval} [options.setInterval]
 * @param {typeof clearInterval} [options.clearInterval]
 */
export function createApp(gladys, options = {}) {
  const {
    fetch: fetchImpl = globalThis.fetch,
    memoryFile,
    now = () => new Date(),
    setInterval: setTimer = setInterval,
    clearInterval: clearTimer = clearInterval,
  } = options;

  let config = normalizeConfig();
  let client = null;
  let snapshot = null;
  let devicesSignature = null;
  let timer = null;
  let running = null;
  const cache = createMenuCache({ now: () => now().getTime() });
  const memory = loadMemory(memoryFile);

  function applyConfig(raw) {
    const previous = config;
    config = normalizeConfig(raw);
    applyLogLevel(config);
    const sameAccount =
      client !== null && config.email === previous.email && config.password === previous.password;
    if (sameAccount) {
      // A reconnection or another setting: keep the session, the cached
      // menus and the last snapshot (the booking changes are diffs of it).
      return;
    }
    client = hasCredentials(config)
      ? new AppTableClient({ email: config.email, password: config.password, fetch: fetchImpl })
      : null;
    // Another account may see other restaurants: forget its menus and data.
    cache.clear();
    snapshot = null;
    devicesSignature = null;
  }

  async function publishDevices() {
    const devices = buildDiscoveredDevices(gladys, snapshot);
    const signature = JSON.stringify(devices.map((device) => [device.external_id, device.name]));
    if (signature !== devicesSignature) {
      await gladys.publishDiscoveredDevices(devices);
      devicesSignature = signature;
    }
  }

  async function runRefresh() {
    if (!client) {
      await gladys.setConnectionStatus(false, MESSAGES.missingCredentials);
      throw new Error('AppTable account not configured');
    }
    let next;
    try {
      next = await fetchSnapshot(client, { cache, now: now() });
    } catch (err) {
      logger.warn(`AppTable refresh failed: ${err.message}`);
      await gladys.setConnectionStatus(false, failureMessage(err)).catch(() => {});
      if (snapshot) {
        await gladys.publishTransports(transportsOf(gladys, snapshot, false)).catch(() => {});
      }
      throw err;
    }

    const known = await memory;
    const events = detectEvents(gladys, snapshot, next, known.invoiceIds);
    snapshot = next;
    logger.info(
      `AppTable refreshed: ${next.children.length} child(ren), ${next.menus.size} menu(s), ` +
        `invoices ${next.invoices ? 'read' : 'unavailable'}`,
    );

    await publishDevices();
    try {
      await gladys.publishChangedStates(statesOf(gladys, next), { heartbeat: STATE_HEARTBEAT_MS });
    } catch (err) {
      // The SDK only remembers the states Gladys accepted: the refused ones go
      // again at the next refresh. The scene events must not wait for that.
      logger.warn(`States refused by Gladys: ${err.message}`);
    }
    await publishEvents(gladys, events);
    if (next.invoices) {
      await known.rememberInvoices(next.invoices.invoices.map((invoice) => invoice.id));
    }
    const transports = transportsOf(gladys, next, true);
    if (transports.length > 0) {
      await gladys.publishTransports(transports);
    }
    await gladys.setConnectionStatus(true);
    refreshWidgets(gladys);
    return next;
  }

  /** Read AppTable now (shared when a refresh is already running). */
  function refresh() {
    if (!running) {
      running = runRefresh().finally(() => {
        running = null;
      });
    }
    return running;
  }

  function armTimer() {
    if (timer) {
      clearTimer(timer);
    }
    timer = setTimer(
      () => {
        refresh().catch(() => {});
      },
      config.refresh_minutes * 60 * 1000,
    );
  }

  function stopTimer() {
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
  }

  async function start(raw) {
    applyConfig(raw);
    // Gladys may have restarted while we were away: publish the devices again.
    devicesSignature = null;
    armTimer();
    // A refresh that fails reports itself through the connection status, and
    // the timer tries again: starting never fails because AppTable is down.
    await refresh().catch(() => {});
  }

  // --- Discovery ---------------------------------------------------------------
  gladys.onScanRequest(async () => {
    if (!snapshot) {
      await refresh();
    }
    devicesSignature = null;
    await publishDevices();
  });

  // A device just created by the user: its states can only be stored now (the
  // SDK forgot what was published for it), no need to wait for the next tick.
  gladys.onDeviceCreated(async () => {
    if (snapshot) {
      await gladys.publishChangedStates(statesOf(gladys, snapshot), {
        heartbeat: STATE_HEARTBEAT_MS,
      });
    }
  });

  // --- Configuration screen actions ---------------------------------------------
  gladys.onAction(ACTIONS.TEST_CONNECTION, async () => {
    if (!client) {
      return MESSAGES.missingCredentials;
    }
    try {
      return connectionReport(await refresh());
    } catch (err) {
      return failureMessage(err);
    }
  });

  // --- Scene actions ---------------------------------------------------------------
  const sceneHandlers = sceneActionHandlers({
    gladys,
    snapshot: async () => snapshot ?? refresh(),
    refresh,
  });
  for (const [key, handler] of Object.entries(sceneHandlers)) {
    gladys.onSceneAction(key, handler);
  }

  // --- Dashboard widgets ---------------------------------------------------------
  const widgets = widgetHandlers({ gladys, current: () => snapshot, refresh });
  for (const [key, widget] of Object.entries(widgets)) {
    gladys.onWidgetGet(key, (request) => widget.get(request));
    if (widget.action) {
      gladys.onWidgetAction(key, (actionKey, params) => widget.action(actionKey, params));
    }
  }

  // --- Lifecycle -------------------------------------------------------------------
  gladys.onConfigUpdated(async (newConfig) => {
    logger.info('Configuration updated');
    await start(newConfig);
  });

  gladys.on('connected', async () => {
    await start(await gladys.getConfig());
  });

  gladys.on('disconnected', () => {
    stopTimer();
  });

  return {
    refresh,
    stop: stopTimer,
    get snapshot() {
      return snapshot;
    },
    get config() {
      return config;
    },
  };
}
