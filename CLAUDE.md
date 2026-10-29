# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step, one runtime
dependency: `@gladysassistant/integration-sdk`) for **AppTable**, the app of the **Elior**
school canteens (France and Monaco, formerly Bon'App). It logs in with the parent's AppTable
email and password and publishes, per child, the meal booked today/tomorrow and the menu of
today/tomorrow, plus one account device with the amount due and the invoices to pay. Requires
Gladys 5.3+. Scene triggers (new invoice, booking changed), scene actions (get a child's
menu, refresh now) and two widgets (canteen menu, canteen account).

Started from [GladysAssistant/integration-template-js](https://github.com/GladysAssistant/integration-template-js);
workflows mirror [prohand/gladys-devmel](https://github.com/prohand/gladys-devmel).

## Commands

```bash
npm install
npm test                                    # node --test (built-in runner)
node --test test/sync.test.js               # one file
node --test --test-name-pattern "menu"      # tests by name
npm run lint                                # eslint .
npm run format:check                        # prettier --check . (CI gate)
npm run format                              # prettier --write .
npx github:GladysAssistant/integration-store --skip-image-check .   # store checks
```

CI runs `format:check`, `lint`, `test` (Node 22 + 24), the store checks and a Docker build.
Releases: **Actions → Release** only (bumps `package.json`, manifest `version` +
`docker_image`, rolls `CHANGELOG.md`, tags, builds, publishes the GitHub Release).

## Architecture

```
index.js                  SDK bootstrap only: createApp(gladys), connect, shutdown
src/app.js                all the wiring: config, refresh timer, handlers, publish
src/config.js             defaults + normalization (+ the debug_logs switch)
src/dates.js              days as YYYY-MM-DD strings, in Europe/Paris
src/i18n.js               LANGUAGES (en, fr, de, es), pick, localize
src/memory.js             invoice ids already seen, in /data
src/apptable/client.js    HTTP client: client-settings.json, login, token refresh, calls
src/apptable/parse.js     pure readers of the API answers (children, menus, bookings, invoices)
src/apptable/sync.js      one refresh -> a snapshot; menu cache and dedup
src/devices/index.js      device payloads, states, transport badges
src/capabilities/scenes.js triggers (diff of two snapshots) and scene actions
src/capabilities/widgets.js the two widgets
```

### Invariants worth knowing

- **The API is not public.** It is the one the AppTable web app uses
  (`https://apptable.elior.com`). Its domain, `api-key` and `X-Tenant-Key` come from
  `client-settings.json` at runtime: never hard-code them. Every call is a `POST`.
- **Menus are per restaurant + section, not per child.** `menuKey()` is the dedup key: two
  children sharing it share ONE request, ONE cache entry, ONE widget row. Keep it that way.
- **One refresh feeds everything.** No device has a `poll_frequency`; `src/app.js` runs its
  own timer (`refresh_minutes`, 15–1440) and publishes with `publishChangedStates`.
- **Unknown is not zero.** A read that failed is left out of the states (never published as
  0 or empty); a day without meal is published as `—`.
- **Bookings are read-only.** Changing one costs money and has deadlines shown in the app: no
  `onSetValue`, no booking scene action, unless the API is understood and tested.
- **Events are diffs.** `booking_changed` compares the same DATE across two snapshots (no
  event at midnight); `new_invoice` compares with ids stored in `/data` (the invoices present
  at the first start are not announced).
- **Secrets**: the password and the tokens never reach a log line nor an error message.
- Trigger, action, widget and feature keys are stored by users: never rename them.
- Days are `YYYY-MM-DD` strings in Europe/Paris; never pass a `Date` between modules.

### Manifest

`test/manifest.test.js` keeps `gladys-assistant-integration.json` (config schema, handlers,
scene/widget keys, 4 languages everywhere, store length limits, `keywords`/`countries`,
`gladys_version >=5.3.0`, `transports: ["cloud"]`) in sync with the code.

## Testing

No network: `test/helpers/fakeAppTable.js` is a fake AppTable server (a `fetch`), and the
tests drive the app through `createFakeGladys()` from `@gladysassistant/integration-sdk/testing`.
Widget contents are checked with `validateWidgetContent` (must return `[]`).

## Conventions

Prettier formats, ESLint catches mistakes. Comments explain **why**. User-facing text is
`{ en, fr, de, es }` (see `src/i18n.js`); device and feature names are French (AppTable is a
French service). User docs in `docs/en.md`, `docs/fr.md`, `docs/de.md`, `docs/es.md`, kept in
sync. Every change goes under `## [Unreleased]` in `CHANGELOG.md`.
