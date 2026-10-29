# AppTable Elior — documentation

This integration connects Gladys to **AppTable**, the app of the **Elior** school
canteens (it replaces the former Bon'App app). For each of your children it reads the
canteen menu and the meal booking, and for your account, the invoices to pay.

## Requirements

- Gladys **5.3** or newer.
- An AppTable account (the one of the mobile app or of
  [apptable.elior.com](https://apptable.elior.com)), with at least one child attached.
- Gladys needs Internet access: AppTable is a **cloud** service.

## Configuration

1. Install the **AppTable Elior** integration from the integrations catalog.
2. In the **Configuration** screen of the integration, fill in:
   - **Email**: the address of your AppTable account;
   - **Password**: the password of that account (a secret field, never shown nor
     written in the logs);
   - **Refresh interval**: how often AppTable is read, in minutes (60 by default, 15 to
     1440).
3. Click **Test the connection**: the message gives the number of children found and the
   number of invoices to pay.
4. In the **Discover** tab, add the devices offered.

When the password is refused, the Configuration screen says so. When AppTable cannot be
reached, the integration tries again by itself at the next interval.

## Devices

**One device per child** — "Cantine Léa":

| Feature                   | Type               | Content                                     |
| ------------------------- | ------------------ | ------------------------------------------- |
| Repas réservé aujourd'hui | switch (read-only) | 1 = booked today, 0 = not booked            |
| Repas réservé demain      | switch (read-only) | 1 = booked tomorrow, 0 = not booked         |
| Menu d'aujourd'hui        | text               | "Carottes râpées, Poulet basquaise, Yaourt" |
| Menu de demain            | text               | the same, for tomorrow                      |

A day without a meal (weekend, holidays, menu not published yet) shows "—". Bookings
only appear when your account manages the bookings of that child.

**One device for the account** — "AppTable – Factures":

| Feature          | Type     | Content                                |
| ---------------- | -------- | -------------------------------------- |
| Montant à payer  | currency | total of the unpaid invoices, in euro  |
| Factures à payer | counter  | number of invoices waiting for payment |

The device and feature names are in French, like the AppTable service: rename them in
Gladys if you like. Bookings are changed in the AppTable app (where the deadlines and
prices of the town are shown): in Gladys they are read-only.

### Brothers and sisters: one menu

Two children eating in the **same school restaurant and the same section** have the same
menu. The integration then asks AppTable for it **only once**, and the "Canteen menu"
widget shows it once with the first names of the children concerned. Each child still
keeps their own device and their own bookings.

## Scene triggers

- **A new canteen invoice is available** — an invoice just appeared in the account.
  Variables: `label`, `amount` (in €), `period` (month, YYYY-MM), `paid`. The invoices
  already there at the first installation are not announced.
- **A canteen meal booking changed** — a child's meal today or tomorrow was booked or
  cancelled (by the other parent, the school or yourself). Filters: the child, the
  change (booked / cancelled), the day (today / tomorrow). Variables: `child_name`,
  `change`, `when`, `date`.

Example: "When a child's meal of tomorrow is cancelled, send me a message:
{{triggerEvent.data.child_name}}'s meal is cancelled for tomorrow."

## Scene actions

- **Get a child's canteen menu** — choose the child and the day (next meal, today,
  tomorrow). Outputs: `menu` (the menu on one line), `has_menu`, `date`, `booked`,
  `child_name`. "Next meal" means today until 2 pm, then the next day with a menu (Monday,
  on a Friday afternoon).
- **Refresh AppTable now** — reads AppTable without waiting for the interval. Outputs:
  `children`, `amount_due`, `invoices_to_pay`.

Example of a morning scene: trigger "every day at 7:30", action "Get a child's canteen
menu", then "Send a message" with the text `At the canteen today: {{0.0.menu}}`.

## Dashboard widgets

- **Canteen menu** — the menu of the chosen day (next meal, today or tomorrow). One menu
  for every child: the dishes are listed directly. Different menus (different schools):
  one row per menu, the details on a tap. Below, each child's booking for that day.
- **Canteen account** — the amount due and the number of invoices (live), tomorrow's
  bookings, the time of the last refresh, a **Refresh** button and a link to AppTable.

## FAQ

**The menu shows "—".** No meal is served that day, or the kitchen has not published the
menu yet.

**The invoices do not show.** Some towns do not bill through AppTable: the "Factures"
device then stays empty, the menus still work.

**Is my data shared?** No. The integration talks directly to AppTable, with your
account, from your Gladys. The password stays in the secret field of Gladys.

**Is this an official Elior integration?** No. It is a community integration, using the
same interface as the AppTable website. Should Elior change that interface, an update of
the integration may be needed.

## Troubleshooting

Turn on **Detailed logs** in the configuration, then read the integration logs. The
password and the login tokens never appear in them.
