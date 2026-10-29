import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  capitalize,
  menuKey,
  menuLines,
  menuText,
  parseBookings,
  parseChildren,
  parseInvoices,
  parseMenu,
  MENU_TEXT_LENGTH,
} from '../src/apptable/parse.js';
import { CHILDREN, menuOf } from './helpers/fakeAppTable.js';

test('children keep what the integration needs, ids as strings', () => {
  const [lea] = parseChildren(CHILDREN);
  assert.deepEqual(lea, {
    id: '11',
    firstName: 'Léa',
    school: 'École Jules Ferry',
    restaurantId: 501,
    sectionId: 7,
    sectionCode: 'ELEM',
    billingId: 9011,
  });
});

test('a child without billing id, school or name is still a child', () => {
  const [child] = parseChildren([{ id: 3 }]);
  assert.equal(child.firstName, '#3');
  assert.equal(child.billingId, null);
  assert.equal(child.restaurantId, null);
  assert.equal(menuKey(child, '2026-11-02'), null);
});

test('an answer that is not a list gives no child', () => {
  assert.deepEqual(parseChildren(null), []);
  assert.deepEqual(parseChildren({ error: 'x' }), []);
});

test('two children of the same restaurant and section share the menu key', () => {
  const [lea, tom] = parseChildren(CHILDREN);
  assert.equal(menuKey(lea, '2026-11-02'), menuKey(tom, '2026-11-02'));
  assert.notEqual(menuKey(lea, '2026-11-02'), menuKey(lea, '2026-11-03'));
  assert.notEqual(menuKey(lea, '2026-11-02'), menuKey({ ...tom, sectionId: 8 }, '2026-11-02'));
});

test('the menu of the asked day is read, courses in order, names capitalized', () => {
  const raw = { menusFound: [menuOf('2026-11-01', ['Soupe']), menuOf('2026-11-02')] };
  const menu = parseMenu(raw, '2026-11-02');
  assert.deepEqual(menu.meals, [
    {
      name: 'Dejeuner',
      courses: [
        { name: 'Entree', dishes: ['Carottes râpées'] },
        { name: 'Plat', dishes: ['Poulet basquaise'] },
        { name: 'Dessert', dishes: ['Yaourt'] },
      ],
    },
  ]);
  assert.equal(menuText(menu), 'Carottes râpées, Poulet basquaise, Yaourt');
  assert.equal(
    menuLines(menu),
    'Entree : Carottes râpées\nPlat : Poulet basquaise\nDessert : Yaourt',
  );
});

test('a day without menu, or a menu without dish, is no menu', () => {
  assert.equal(parseMenu({ menusFound: [menuOf('2026-11-02')] }, '2026-11-03'), null);
  assert.equal(parseMenu({}, '2026-11-02'), null);
  const empty = menuOf('2026-11-02');
  empty.prestations[0].famillePlats.forEach((course) => (course.plats = []));
  assert.equal(parseMenu({ menusFound: [empty] }, '2026-11-02'), null);
  assert.equal(menuText(null), '');
});

test('several meals of a day are each named', () => {
  const raw = menuOf('2026-11-02', ['Salade', 'Pâtes']);
  raw.prestations.push({
    id: 2,
    name: 'GOUTER',
    ordre: 2,
    famillePlats: [{ id: 9, name: 'GOUTER', ordre: 1, plats: [{ name: 'PAIN', ordre: 1 }] }],
  });
  const menu = parseMenu({ menusFound: [raw] }, '2026-11-02');
  assert.equal(menuText(menu), 'Dejeuner : Salade, Pâtes — Gouter : Pain');
  assert.match(menuLines(menu), /^— Dejeuner —\n/);
});

test('a very long menu is cut for the text feature', () => {
  const long = Array.from({ length: 60 }, (_, index) => `Plat numéro ${index}`);
  const menu = parseMenu({ menusFound: [menuOf('2026-11-02', long)] }, '2026-11-02');
  assert.equal(menuText(menu).length, MENU_TEXT_LENGTH);
  assert.ok(menuText(menu).endsWith('…'));
});

test('capitalize trims and lowercases', () => {
  assert.equal(capitalize('  POULET   BASQUAISE '), 'Poulet basquaise');
  assert.equal(capitalize(undefined), '');
});

test('bookings: a day is booked when one of its meals is ordered', () => {
  const bookings = parseBookings({
    datas: {
      consommations: [
        {
          jour: '2026-11-02T00:00:00Z',
          inscriptionConsommations: [{ isOrdered: false }, { isOrdered: true }],
        },
        { jour: '2026-11-03T00:00:00Z', inscriptionConsommations: [{ isOrdered: false }] },
        { jour: 'not a date', inscriptionConsommations: [{ isOrdered: true }] },
      ],
    },
  });
  assert.deepEqual(
    [...bookings],
    [
      ['2026-11-02', true],
      ['2026-11-03', false],
    ],
  );
  assert.equal(parseBookings(null).size, 0);
});

test('invoices: the amount due leaves out the paid and the pending ones', () => {
  const result = parseInvoices([
    {
      titulaireId: 1,
      nbFacturesToPay: 1,
      factures: [
        {
          id: 1,
          libelle: 'Octobre',
          montant: 42.5,
          reglee: false,
          datePeriodeFacture: '2026-10-01T00:00:00',
        },
        { id: 2, libelle: 'Septembre', montant: 38.1, reglee: true },
        { id: 3, libelle: 'Août', montant: 10, reglee: false, pendingPayment: true },
      ],
    },
  ]);
  assert.equal(result.amountDue, 42.5);
  assert.equal(result.toPay, 1);
  assert.equal(result.invoices[0].period, '2026-10');
  assert.equal(result.invoices.length, 3);
});

test('invoices: without nbFacturesToPay, the unpaid ones are counted', () => {
  const result = parseInvoices([
    {
      factures: [
        { id: 1, montant: 0.1 },
        { id: 2, montant: 0.2 },
      ],
    },
  ]);
  assert.equal(result.toPay, 2);
  assert.equal(result.amountDue, 0.3);
  assert.deepEqual(parseInvoices(null), { amountDue: 0, toPay: 0, invoices: [] });
});
