// -----------------------------------------------------------------------------
// The Gladys devices of an AppTable account.
//
//   - one device per child ("Cantine Léa"): the meal booked today and
//     tomorrow (read-only switches) and the menu of today and tomorrow (text);
//   - one device for the account ("AppTable – Factures"): the amount due and
//     the number of invoices to pay.
//
// Names are French on purpose: AppTable only serves French and Monegasque
// schools, and the user can rename the devices anyway.
//
// Nothing is polled by Gladys: one API refresh feeds every device at once, so
// index.js runs its own timer and publishes the changed states (see
// statesOf). A device publishes no `poll_frequency`, which is how Gladys knows
// not to call onPoll.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
  DEVICE_TRANSPORTS,
} from '@gladysassistant/integration-sdk';
import { menuText } from '../apptable/parse.js';
import { menuOf } from '../apptable/sync.js';

export const DEVICE_TYPES = { CHILD: 'child', ACCOUNT: 'account' };

/** The account device has no id of its own at AppTable: one per integration. */
const ACCOUNT_ID = 'invoices';

export const FEATURES = {
  BOOKED_TODAY: 'booked-today',
  BOOKED_TOMORROW: 'booked-tomorrow',
  MENU_TODAY: 'menu-today',
  MENU_TOMORROW: 'menu-tomorrow',
  AMOUNT_DUE: 'amount-due',
  INVOICES_TO_PAY: 'invoices-to-pay',
};

/** Published for a day without a meal: an empty text would read as "unknown". */
export const NO_MENU = '—';

export function childIds(gladys, childId) {
  return gladys.externalIds(DEVICE_TYPES.CHILD, childId);
}

export function accountIds(gladys) {
  return gladys.externalIds(DEVICE_TYPES.ACCOUNT, ACCOUNT_ID);
}

/**
 * The child behind a device external_id, or undefined.
 *
 * @param {object} gladys
 * @param {{ children: object[] }|null} snapshot
 * @param {string} externalId
 */
export function childOfDevice(gladys, snapshot, externalId) {
  return snapshot?.children.find((child) => childIds(gladys, child.id).device === externalId);
}

const binary = (name, externalId) => ({
  name,
  external_id: externalId,
  category: DEVICE_FEATURE_CATEGORIES.SWITCH,
  type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  // Read-only: the booking is changed in the AppTable app, where the school's
  // deadlines and prices are shown.
  read_only: true,
  has_feedback: false,
  keep_history: true,
  min: 0,
  max: 1,
});

const menu = (name, externalId) => ({
  name,
  external_id: externalId,
  category: DEVICE_FEATURE_CATEGORIES.TEXT,
  type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
  read_only: true,
  has_feedback: false,
  keep_history: false,
  min: 0,
  max: 0,
});

export function buildChildDevice(gladys, child) {
  const ids = childIds(gladys, child.id);
  const features = [
    menu("Menu d'aujourd'hui", ids.feature(FEATURES.MENU_TODAY)),
    menu('Menu de demain', ids.feature(FEATURES.MENU_TOMORROW)),
  ];
  // Without a billing id the account has no booking module for this child.
  if (child.billingId !== null) {
    features.unshift(
      binary("Repas réservé aujourd'hui", ids.feature(FEATURES.BOOKED_TODAY)),
      binary('Repas réservé demain', ids.feature(FEATURES.BOOKED_TOMORROW)),
    );
  }
  return {
    name: `Cantine ${child.firstName}`,
    external_id: ids.device,
    model: child.school ?? 'AppTable',
    features,
  };
}

export function buildAccountDevice(gladys) {
  const ids = accountIds(gladys);
  return {
    name: 'AppTable – Factures',
    external_id: ids.device,
    model: 'AppTable',
    features: [
      {
        name: 'Montant à payer',
        external_id: ids.feature(FEATURES.AMOUNT_DUE),
        category: DEVICE_FEATURE_CATEGORIES.CURRENCY,
        type: DEVICE_FEATURE_TYPES.CURRENCY.DECIMAL,
        unit: DEVICE_FEATURE_UNITS.EURO,
        read_only: true,
        has_feedback: false,
        keep_history: true,
        min: 0,
        max: 100000,
      },
      {
        name: 'Factures à payer',
        external_id: ids.feature(FEATURES.INVOICES_TO_PAY),
        category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
        type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
        read_only: true,
        has_feedback: false,
        keep_history: true,
        min: 0,
        max: 1000,
      },
    ],
  };
}

/**
 * The discovery payload: every child, then the account.
 *
 * @param {object} gladys
 * @param {{ children: object[] }|null} snapshot null before the first refresh
 */
export function buildDiscoveredDevices(gladys, snapshot) {
  if (!snapshot) {
    return [];
  }
  return [
    ...snapshot.children.map((child) => buildChildDevice(gladys, child)),
    buildAccountDevice(gladys),
  ];
}

/**
 * Every state the snapshot knows, in the `publishStates` format. What the
 * snapshot does not know (a read that failed) is left out, never published as
 * a zero.
 */
export function statesOf(gladys, snapshot) {
  const [today, tomorrow] = snapshot.days;
  const states = [];
  for (const child of snapshot.children) {
    const ids = childIds(gladys, child.id);
    for (const [day, booked, menuFeature] of [
      [today, FEATURES.BOOKED_TODAY, FEATURES.MENU_TODAY],
      [tomorrow, FEATURES.BOOKED_TOMORROW, FEATURES.MENU_TOMORROW],
    ]) {
      if (typeof child.bookings?.[day] === 'boolean') {
        states.push({
          device_feature_external_id: ids.feature(booked),
          state: child.bookings[day] ? 1 : 0,
        });
      }
      const dayMenu = menuOf(snapshot, child, day);
      if (dayMenu !== undefined) {
        states.push({
          device_feature_external_id: ids.feature(menuFeature),
          text: menuText(dayMenu) || NO_MENU,
        });
      }
    }
  }
  if (snapshot.invoices) {
    const ids = accountIds(gladys);
    states.push(
      {
        device_feature_external_id: ids.feature(FEATURES.AMOUNT_DUE),
        state: snapshot.invoices.amountDue,
      },
      {
        device_feature_external_id: ids.feature(FEATURES.INVOICES_TO_PAY),
        state: snapshot.invoices.toPay,
      },
    );
  }
  return states;
}

/**
 * The transport badge of every device: AppTable is a cloud service, reached
 * or not at the last refresh.
 */
export function transportsOf(gladys, snapshot, reachable) {
  const transport = reachable ? DEVICE_TRANSPORTS.CLOUD : DEVICE_TRANSPORTS.UNREACHABLE;
  return buildDiscoveredDevices(gladys, snapshot).map((device) => ({
    external_id: device.external_id,
    transport,
  }));
}
