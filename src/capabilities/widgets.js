// -----------------------------------------------------------------------------
// Dashboard widgets (Gladys 5.1+). Declarative content, rendered by the core
// with its own theme and dark mode — see the "Dashboard widgets" section of the
// SDK README for the vocabulary and the budget.
//
//   menu     "What do the kids eat?": the menu of today, tomorrow or the next
//            meal. Children who share a menu (same restaurant and section)
//            share one card, with their first names together: the same menu
//            is never listed twice.
//   account  the money side: amount due, invoices to pay (live tiles bound to
//            the account device), the meals booked tomorrow, and a button to
//            read AppTable now.
//
// Both read the latest snapshot only: opening a dashboard never calls the API.
// -----------------------------------------------------------------------------

import { createLogger, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { APPTABLE_ORIGIN } from '../apptable/client.js';
import { menuLines, menuText } from '../apptable/parse.js';
import { menuGroups } from '../apptable/sync.js';
import { formatDay } from '../dates.js';
import { accountIds, FEATURES } from '../devices/index.js';
import { localize, pick } from '../i18n.js';
import { DAYS, resolveDay } from './scenes.js';

const logger = createLogger({ name: 'widgets' });

/** Keys of the manifest widgets. Never renamed: dashboards store them. */
export const WIDGET_KEYS = { MENU: 'menu', ACCOUNT: 'account' };

/** Keys of the widget button actions. */
export const WIDGET_ACTIONS = { REFRESH: 'refresh' };

/** The content budget of the core. */
const MAX_LIST_ITEMS = 8;
const MAX_STATUS_ITEMS = 10;

/** Text bounds of the core (characters). */
const BOUNDS = { heading: 40, caption: 80, body: 300, title: 60, subtitle: 60, status: 40 };

export function truncate(value, length) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

const T = {
  notConnected: {
    en: 'Not connected to AppTable yet: check the email and password in the integration settings.',
    fr: "Pas encore connecté à AppTable : vérifiez l'e-mail et le mot de passe dans la configuration de l'intégration.",
    de: 'Noch nicht mit AppTable verbunden: Prüfe E-Mail und Passwort in den Einstellungen der Integration.',
    es: 'Aún no conectado a AppTable: compruebe el correo y la contraseña en la configuración de la integración.',
  },
  noChild: {
    en: 'No child is attached to this AppTable account.',
    fr: "Aucun enfant n'est rattaché à ce compte AppTable.",
    de: 'Diesem AppTable-Konto ist kein Kind zugeordnet.',
    es: 'No hay ningún niño vinculado a esta cuenta de AppTable.',
  },
  noMenu: {
    en: 'No meal served that day, or the menu is not published yet.',
    fr: "Pas de repas servi ce jour-là, ou le menu n'est pas encore publié.",
    de: 'An diesem Tag gibt es kein Essen, oder der Speiseplan ist noch nicht veröffentlicht.',
    es: 'No se sirve comida ese día, o el menú aún no está publicado.',
  },
  unknownMenu: {
    en: 'Menu unavailable',
    fr: 'Menu indisponible',
    de: 'Speiseplan nicht verfügbar',
    es: 'Menú no disponible',
  },
  booked: { en: 'Booked', fr: 'Réservé', de: 'Gebucht', es: 'Reservado' },
  notBooked: { en: 'Not booked', fr: 'Non réservé', de: 'Nicht gebucht', es: 'No reservado' },
  unknown: { en: 'Unknown', fr: 'Inconnu', de: 'Unbekannt', es: 'Desconocido' },
  amountDue: {
    en: 'Amount due',
    fr: 'Montant à payer',
    de: 'Offener Betrag',
    es: 'Importe a pagar',
  },
  toPay: {
    en: 'Invoices to pay',
    fr: 'Factures à payer',
    de: 'Offene Rechnungen',
    es: 'Facturas a pagar',
  },
  tomorrow: { en: 'tomorrow', fr: 'demain', de: 'morgen', es: 'mañana' },
  lastRefresh: {
    en: 'Last refresh',
    fr: 'Dernière mise à jour',
    de: 'Letzte Aktualisierung',
    es: 'Última actualización',
  },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  open: { en: 'Open AppTable', fr: 'Ouvrir AppTable', de: 'AppTable öffnen', es: 'Abrir AppTable' },
  refreshed: {
    en: 'AppTable data refreshed.',
    fr: 'Données AppTable actualisées.',
    de: 'AppTable-Daten aktualisiert.',
    es: 'Datos de AppTable actualizados.',
  },
};

/** "Léa, Tom" — the children sharing a menu. */
function names(children) {
  return children.map((child) => child.firstName).join(', ');
}

/** The booking of a day for a set of children, as a badge (null if mixed or unknown). */
function bookingBadge(children, day) {
  const states = children.map((child) => child.bookings?.[day]);
  if (states.some((state) => typeof state !== 'boolean') || new Set(states).size !== 1) {
    return null;
  }
  return states[0]
    ? { text: T.booked, color: WIDGET_COLORS.SUCCESS }
    : { text: T.notBooked, color: WIDGET_COLORS.NEUTRAL };
}

function bookingStatus(child, day) {
  const state = child.bookings?.[day];
  if (typeof state !== 'boolean') {
    return { value: T.unknown, color: WIDGET_COLORS.NEUTRAL };
  }
  return state
    ? { value: T.booked, color: WIDGET_COLORS.SUCCESS }
    : { value: T.notBooked, color: WIDGET_COLORS.WARNING };
}

/**
 * Content of the `menu` widget.
 *
 * @param {object|null} snapshot
 * @param {object} options
 * @param {string} [options.day] the `day` setting: today | tomorrow | next
 * @param {string} [options.language]
 * @param {Date} [options.now]
 */
export function menuWidget(snapshot, { day: choice = DAYS.NEXT, language = 'en', now } = {}) {
  if (!snapshot) {
    return { ttl_seconds: 60, components: [{ type: 'text', text: T.notConnected }] };
  }
  if (snapshot.children.length === 0) {
    return { ttl_seconds: 900, components: [{ type: 'text', text: T.noChild }] };
  }
  const day = resolveDay(
    snapshot,
    choice,
    (candidate) => menuGroups(snapshot, candidate).some((group) => group.menu),
    now,
  );
  const groups = menuGroups(snapshot, day);
  const components = [
    {
      type: 'text',
      variant: 'heading',
      text: truncate(capitalizeFirst(formatDay(day, language)), BOUNDS.heading),
    },
  ];

  const served = groups.filter((group) => group.menu);
  if (served.length === 0) {
    components.push({
      type: 'text',
      text: groups.some((group) => group.menu === undefined) ? T.unknownMenu : T.noMenu,
    });
  } else if (served.length === 1 && groups.length === 1) {
    // One menu for everybody (one child, or brothers and sisters in the same
    // canteen): the courses ARE the list, readable without a tap.
    const [group] = served;
    components.push({
      type: 'card-list',
      display: 'list',
      items: group.menu.meals
        .flatMap((meal) =>
          meal.courses.map((course) => ({
            title: truncate(course.dishes.join(', '), BOUNDS.title),
            subtitle: truncate(
              group.menu.meals.length > 1 && meal.name
                ? `${meal.name} · ${course.name}`
                : course.name,
              BOUNDS.subtitle,
            ),
            ...(course.dishes.join(', ').length > BOUNDS.title
              ? { description: course.dishes.join('\n') }
              : {}),
          })),
        )
        .slice(0, MAX_LIST_ITEMS),
    });
  } else {
    // Different menus (children in different schools): one row per menu, the
    // courses behind a tap. Children sharing a menu share the row.
    components.push({
      type: 'card-list',
      display: 'list',
      items: groups.slice(0, MAX_LIST_ITEMS).map((group) => {
        const badge = bookingBadge(group.children, day);
        return {
          title: truncate(names(group.children), BOUNDS.title),
          subtitle: group.menu
            ? truncate(menuText(group.menu), BOUNDS.subtitle)
            : truncate(
                pick(language, group.menu === null ? T.noMenu : T.unknownMenu),
                BOUNDS.subtitle,
              ),
          ...(group.menu ? { description: menuLines(group.menu) } : {}),
          ...(badge ? { badge } : {}),
        };
      }),
    });
  }

  const note = served.map((group) => group.menu.note).find(Boolean);
  if (note) {
    components.push({ type: 'text', variant: 'caption', text: truncate(note, BOUNDS.caption) });
  }

  const booked = snapshot.children.filter((child) => typeof child.bookings?.[day] === 'boolean');
  if (booked.length > 0) {
    components.push({
      type: 'status',
      items: booked.slice(0, MAX_STATUS_ITEMS).map((child) => ({
        label: truncate(child.firstName, BOUNDS.status),
        icon: 'calendar',
        ...bookingStatus(child, day),
      })),
    });
  }
  return { ttl_seconds: 900, components };
}

/**
 * Content of the `account` widget.
 *
 * @param {object} gladys for the account feature external ids
 * @param {object|null} snapshot
 * @param {object} [options]
 * @param {string} [options.language]
 */
export function accountWidget(gladys, snapshot, { language = 'en' } = {}) {
  if (!snapshot) {
    return { ttl_seconds: 60, components: [{ type: 'text', text: T.notConnected }] };
  }
  const ids = accountIds(gladys);
  const tomorrow = snapshot.days[1];
  const components = [
    {
      type: 'value',
      label: T.amountDue,
      icon: 'credit-card',
      device_feature: ids.feature(FEATURES.AMOUNT_DUE),
    },
    {
      type: 'value',
      label: T.toPay,
      icon: 'file-text',
      device_feature: ids.feature(FEATURES.INVOICES_TO_PAY),
    },
  ];
  const time = new Date(snapshot.fetchedAt).toLocaleTimeString(
    pick(language, { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' }),
    { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' },
  );
  components.push({
    type: 'status',
    items: [
      ...snapshot.children
        .filter((child) => child.billingId !== null)
        .slice(0, MAX_STATUS_ITEMS - 1)
        .map((child) => ({
          label: localize((lang) =>
            truncate(`${child.firstName} · ${pick(lang, T.tomorrow)}`, BOUNDS.status),
          ),
          icon: 'calendar',
          ...bookingStatus(child, tomorrow),
        })),
      { label: T.lastRefresh, icon: 'clock', value: time, color: WIDGET_COLORS.NEUTRAL },
    ],
  });
  components.push(
    {
      type: 'button',
      label: T.refresh,
      icon: 'refresh-cw',
      style: 'secondary',
      action: { key: WIDGET_ACTIONS.REFRESH },
    },
    {
      type: 'button',
      label: T.open,
      icon: 'external-link',
      style: 'secondary',
      link: { url: APPTABLE_ORIGIN },
    },
  );
  return { ttl_seconds: 900, components };
}

/**
 * The widget handlers, registered by index.js.
 *
 * @param {object} context
 * @param {object} context.gladys
 * @param {() => object|null} context.current the latest snapshot, or null
 * @param {() => Promise<object>} context.refresh read AppTable now
 */
export function widgetHandlers({ gladys, current, refresh }) {
  return {
    [WIDGET_KEYS.MENU]: {
      async get({ settings, language }) {
        logger.debug(`onWidgetGet <- ${WIDGET_KEYS.MENU}`);
        return menuWidget(current(), { day: settings?.day, language });
      },
    },
    [WIDGET_KEYS.ACCOUNT]: {
      async get({ language }) {
        logger.debug(`onWidgetGet <- ${WIDGET_KEYS.ACCOUNT}`);
        return accountWidget(gladys, current(), { language });
      },
      action: refreshAction(refresh),
    },
  };
}

function refreshAction(refresh) {
  return async (actionKey) => {
    if (actionKey !== WIDGET_ACTIONS.REFRESH) {
      throw new Error(`Unknown widget action: ${actionKey}`);
    }
    await refresh();
    return T.refreshed;
  };
}

/** Ask every open dashboard to re-pull the widgets (after a refresh). */
export function refreshWidgets(gladys) {
  for (const key of Object.values(WIDGET_KEYS)) {
    gladys.requestWidgetRefresh(key);
  }
}

function capitalizeFirst(value) {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}
