// -----------------------------------------------------------------------------
// Turn AppTable answers into the small shapes the rest of the code uses.
//
// Pure functions, no I/O: the tests feed them recorded-looking answers. The API
// is not documented, so every reader is tolerant — a missing list is an empty
// list, an unknown field is ignored — and never throws on a shape it does not
// know: a partial answer must not cost the user the rest of the data.
// -----------------------------------------------------------------------------

import { dayOf } from '../dates.js';

/** Longest text published in a menu feature (a whole week would not fit a tile). */
export const MENU_TEXT_LENGTH = 500;

const byOrder = (a, b) => (a?.ordre ?? 0) - (b?.ordre ?? 0);
const list = (value) => (Array.isArray(value) ? value : []);
const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** "CAROTTES RAPEES" -> "Carottes rapees", like the AppTable app shows them. */
export function capitalize(value) {
  const clean = text(value).replace(/\s+/g, ' ');
  return clean.length === 0 ? '' : clean[0].toUpperCase() + clean.slice(1).toLowerCase();
}

/**
 * The children ("convives") of the account.
 *
 * @param {any} raw answer of /user/get-convive-list
 * @returns {Array<{ id: string, firstName: string, school: string|null,
 *   restaurantId: unknown, sectionId: unknown, sectionCode: string|null,
 *   billingId: unknown }>}
 */
export function parseChildren(raw) {
  return list(raw)
    .filter((convive) => convive?.id !== undefined && convive?.id !== null)
    .map((convive) => ({
      id: String(convive.id),
      firstName: text(convive.firstName) || text(convive.prenom) || `#${convive.id}`,
      school: text(convive.etablissement?.name) || null,
      restaurantId: convive.etablissement?.restaurantId ?? null,
      sectionId: convive.section?.id ?? null,
      sectionCode: text(convive.section?.code) || null,
      // The meal bookings are keyed by this id, not by the child id. A child
      // without it has no booking module (menus only).
      billingId: convive.bonAppFacturationConviveId ?? null,
    }));
}

/**
 * The key of a menu: two children eating in the same restaurant and section
 * get the SAME menu, so it is fetched, published and shown once for both.
 *
 * @returns {string|null} null when the child has no restaurant (no menu)
 */
export function menuKey(child, day) {
  if (child.restaurantId === null || child.restaurantId === undefined) {
    return null;
  }
  return `${child.restaurantId}|${child.sectionId ?? ''}|${day}`;
}

/**
 * The menu of one day, out of an /menus answer (which may hold several days).
 *
 * @param {any} raw answer of /menus
 * @param {string} day YYYY-MM-DD
 * @returns {{ day: string, note: string|null, meals: Array<{ name: string,
 *   courses: Array<{ name: string, dishes: string[] }> }> }|null}
 *   null when nothing is served that day
 */
export function parseMenu(raw, day) {
  const found = list(raw?.menusFound).find((menu) => dayOf(menu?.date) === day);
  if (!found) {
    return null;
  }
  const meals = list(found.prestations)
    .slice()
    .sort(byOrder)
    .map((meal) => ({
      name: capitalize(meal?.name),
      courses: list(meal?.famillePlats)
        .slice()
        .sort(byOrder)
        .map((course) => ({
          name: capitalize(course?.name),
          dishes: list(course?.plats)
            .slice()
            .sort(byOrder)
            .map((dish) => capitalize(dish?.name))
            .filter((name) => name.length > 0),
        }))
        .filter((course) => course.dishes.length > 0),
    }))
    .filter((meal) => meal.courses.length > 0);
  if (meals.length === 0) {
    return null;
  }
  return { day, note: text(found.animation) || null, meals };
}

/**
 * A menu on one line: "Carottes râpées, Poulet basquaise, Riz, Yaourt".
 * Several meals (lunch and snack) are each named.
 *
 * @param {ReturnType<typeof parseMenu>} menu
 * @returns {string} '' when there is no menu
 */
export function menuText(menu) {
  if (!menu) {
    return '';
  }
  const named = menu.meals.length > 1;
  const line = menu.meals
    .map((meal) => {
      const dishes = meal.courses.flatMap((course) => course.dishes).join(', ');
      return named && meal.name ? `${meal.name} : ${dishes}` : dishes;
    })
    .join(' — ');
  return line.length > MENU_TEXT_LENGTH ? `${line.slice(0, MENU_TEXT_LENGTH - 1)}…` : line;
}

/**
 * A menu course by course, one line each: "Entrée : Carottes râpées".
 *
 * @param {ReturnType<typeof parseMenu>} menu
 * @returns {string}
 */
export function menuLines(menu) {
  if (!menu) {
    return '';
  }
  const named = menu.meals.length > 1;
  return menu.meals
    .flatMap((meal) => [
      ...(named && meal.name ? [`— ${meal.name} —`] : []),
      ...meal.courses.map((course) =>
        course.name ? `${course.name} : ${course.dishes.join(', ')}` : course.dishes.join(', '),
      ),
    ])
    .join('\n');
}

/**
 * Whether a meal is booked, day by day.
 *
 * @param {any} raw answer of /convive-consommations
 * @returns {Map<string, boolean>} YYYY-MM-DD -> at least one meal booked
 */
export function parseBookings(raw) {
  const bookings = new Map();
  for (const entry of list(raw?.datas?.consommations)) {
    const day = dayOf(entry?.jour);
    if (day) {
      const booked = list(entry.inscriptionConsommations).some((item) => item?.isOrdered === true);
      bookings.set(day, (bookings.get(day) ?? false) || booked);
    }
  }
  return bookings;
}

/**
 * The invoices of the account, all account holders together.
 *
 * @param {any} raw answer of /factures
 * @returns {{ amountDue: number, toPay: number, invoices: Array<{ id: string,
 *   label: string, amount: number, paid: boolean, pending: boolean,
 *   period: string|null }> }}
 */
export function parseInvoices(raw) {
  const invoices = [];
  let toPay = null;
  for (const holder of list(raw)) {
    if (Number.isFinite(holder?.nbFacturesToPay)) {
      toPay = (toPay ?? 0) + holder.nbFacturesToPay;
    }
    for (const invoice of list(holder?.factures)) {
      if (invoice?.id === undefined || invoice?.id === null) {
        continue;
      }
      const amount = Number(invoice.montant);
      invoices.push({
        id: String(invoice.id),
        label: text(invoice.libelle),
        amount: Number.isFinite(amount) ? amount : 0,
        paid: invoice.reglee === true,
        // Paid online, waiting for the bank: not due anymore.
        pending: invoice.pendingPayment === true,
        period: dayOf(invoice.datePeriodeFacture)?.slice(0, 7) ?? null,
      });
    }
  }
  const due = invoices.filter((invoice) => !invoice.paid && !invoice.pending);
  const amountDue = Math.round(due.reduce((sum, invoice) => sum + invoice.amount, 0) * 100) / 100;
  // nbFacturesToPay is what the app shows; count them ourselves if absent.
  return { amountDue, toPay: toPay ?? due.length, invoices };
}
