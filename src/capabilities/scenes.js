// -----------------------------------------------------------------------------
// Scene triggers and scene actions (Gladys 5.1+).
//
// Triggers — what HAPPENED, found by comparing a refresh with the previous one:
//
//   new_invoice      an invoice appeared in the account ("a new invoice of
//                    42.50 € is waiting": a notification, a reminder).
//   booking_changed  the meal of a child today or tomorrow was booked or
//                    cancelled — by the other parent, by the school, by you in
//                    the app. The booking itself stays a device feature (a
//                    state); the event says "it just changed".
//
// Actions — OPERATIONS a scene runs, with outputs for the next actions:
//
//   get_menu         the menu of a child for today, tomorrow or the next
//                    school day, as one line of text ("tell me at 7:30 what
//                    the kids eat at noon").
//   refresh          read AppTable now, outside the refresh interval.
//
// Doctrine of the core: one event per transition, flat data, and never fire an
// event because of a received action (a scene bound to it would loop).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { menuText } from '../apptable/parse.js';
import { menuOf } from '../apptable/sync.js';
import { localHour } from '../dates.js';
import { childIds } from '../devices/index.js';

const logger = createLogger({ name: 'scenes' });

/** Keys of the manifest `scene_triggers`. Never renamed: scenes store them. */
export const SCENE_TRIGGERS = {
  NEW_INVOICE: 'new_invoice',
  BOOKING_CHANGED: 'booking_changed',
};

/** Keys of the manifest `scene_actions`. Same rule. */
export const SCENE_ACTIONS = {
  GET_MENU: 'get_menu',
  REFRESH: 'refresh',
};

/** Values of the `change` filter of booking_changed. */
export const BOOKING_CHANGES = { BOOKED: 'booked', CANCELLED: 'cancelled' };

/** Values of the `when` filter of booking_changed and the `day` field of get_menu. */
export const DAYS = { TODAY: 'today', TOMORROW: 'tomorrow', NEXT: 'next' };

/** After this hour (Paris), "the next meal" is tomorrow's: lunch is over. */
export const LUNCH_OVER_HOUR = 14;

/**
 * The scene events between two refreshes.
 *
 * @param {object} gladys for the device external ids
 * @param {object|null} previous the previous snapshot (null after a start)
 * @param {object} current the new snapshot
 * @param {Set<string>|null} knownInvoices invoice ids already seen (null: none
 *   ever stored — the current invoices are then taken as known, not new)
 * @returns {Array<{ key: string, data: object }>}
 */
export function detectEvents(gladys, previous, current, knownInvoices) {
  const events = [];

  if (current.invoices && knownInvoices) {
    for (const invoice of current.invoices.invoices) {
      if (!knownInvoices.has(invoice.id)) {
        events.push({
          key: SCENE_TRIGGERS.NEW_INVOICE,
          data: {
            label: invoice.label,
            amount: invoice.amount,
            period: invoice.period,
            paid: invoice.paid,
          },
        });
      }
    }
  }

  if (previous) {
    const [today, tomorrow] = current.days;
    for (const child of current.children) {
      const before = previous.children.find((other) => other.id === child.id);
      // Compared day by day, not "today" with "today": at midnight yesterday's
      // tomorrow becomes today's today, and that is not a change.
      for (const [day, when] of [
        [today, DAYS.TODAY],
        [tomorrow, DAYS.TOMORROW],
      ]) {
        const was = before?.bookings?.[day];
        const is = child.bookings?.[day];
        if (typeof was === 'boolean' && typeof is === 'boolean' && was !== is) {
          events.push({
            key: SCENE_TRIGGERS.BOOKING_CHANGED,
            data: {
              device: childIds(gladys, child.id).device,
              child_name: child.firstName,
              when,
              change: is ? BOOKING_CHANGES.BOOKED : BOOKING_CHANGES.CANCELLED,
              date: day,
            },
          });
        }
      }
    }
  }
  return events;
}

/**
 * Fire the events. Never throws: an event Gladys refused (rate limit, a core
 * without the trigger) must not cost the refresh its states.
 */
export async function publishEvents(gladys, events) {
  for (const event of events) {
    try {
      await gladys.publishSceneEvent(event.key, event.data);
      logger.info(`Scene event ${event.key} fired`);
    } catch (err) {
      logger.warn(`Scene event ${event.key} refused: ${err.message}`);
    }
  }
}

/**
 * The day a "today / tomorrow / next" choice means right now.
 *
 * `next` is the next meal: today until lunch is over, else the first day
 * after with a menu (Friday afternoon -> Monday).
 *
 * @param {object} snapshot
 * @param {string} choice a value of DAYS
 * @param {(day: string) => boolean} hasMenu
 * @param {Date} [now]
 * @returns {string} YYYY-MM-DD
 */
export function resolveDay(snapshot, choice, hasMenu, now = new Date()) {
  const [today, tomorrow] = snapshot.days;
  if (choice === DAYS.TODAY) {
    return today;
  }
  if (choice === DAYS.TOMORROW) {
    return tomorrow;
  }
  const from = localHour(now) < LUNCH_OVER_HOUR ? 0 : 1;
  const candidates = snapshot.days.slice(from);
  return candidates.find(hasMenu) ?? candidates[0];
}

/**
 * The scene action handlers, keyed by SCENE_ACTIONS value.
 *
 * @param {object} context
 * @param {object} context.gladys
 * @param {() => Promise<object>} context.snapshot the latest snapshot (refreshes
 *   once when there is none yet)
 * @param {() => Promise<object>} context.refresh read AppTable now
 */
export function sceneActionHandlers({ gladys, snapshot, refresh }) {
  return {
    async [SCENE_ACTIONS.GET_MENU](fields) {
      const current = await snapshot();
      const child = current.children.find(
        (candidate) => childIds(gladys, candidate.id).device === fields.device,
      );
      if (!child) {
        // The account device has no menu: say so, the scene logs it.
        throw new Error('Choose the device of a child (Cantine …)');
      }
      const day = resolveDay(current, fields.day ?? DAYS.NEXT, (candidate) =>
        Boolean(menuOf(current, child, candidate)),
      );
      const menu = menuOf(current, child, day);
      return {
        menu: menuText(menu),
        has_menu: Boolean(menu),
        date: day,
        booked: child.bookings?.[day] ?? false,
        child_name: child.firstName,
      };
    },

    async [SCENE_ACTIONS.REFRESH]() {
      const current = await refresh();
      return {
        children: current.children.length,
        amount_due: current.invoices?.amountDue ?? 0,
        invoices_to_pay: current.invoices?.toPay ?? 0,
      };
    },
  };
}
