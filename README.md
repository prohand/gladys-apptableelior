# AppTable Elior for Gladys Assistant

External integration for [Gladys Assistant](https://gladysassistant.com) that brings
**AppTable** — the app of the **Elior** school canteens (formerly Bon'App) — into Gladys:
your children's canteen menus, their meal bookings and your invoices.

> Community integration, not affiliated with Elior. It uses the same interface as the
> AppTable website, with your own account.

## Features

| Surface        | What you get                                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Devices        | one per child (meal booked today / tomorrow, menu of today / tomorrow) + one for the account (amount due, invoices to pay) |
| Scene triggers | `new_invoice` — a new invoice is available; `booking_changed` — a meal was booked or cancelled                             |
| Scene actions  | `get_menu` — a child's menu as text (today, tomorrow, next meal); `refresh` — read AppTable now                            |
| Widgets        | `menu` — canteen menu; `account` — amount due, invoices, tomorrow's bookings                                               |
| Transport      | `cloud` (AppTable is a cloud service)                                                                                      |
| Languages      | English, French, German, Spanish                                                                                           |

Children who eat in the **same restaurant and section** share the same menu: it is fetched
once and shown once in the widget, with their first names together.

User documentation: [English](docs/en.md) · [Français](docs/fr.md) ·
[Deutsch](docs/de.md) · [Español](docs/es.md).

## Requirements

- Gladys **5.3.0** or newer (scene triggers/actions, widgets, catalog keywords and countries).
- An AppTable account with at least one child.

## Project structure

```
.
├─ index.js                          # SDK bootstrap (createApp + connect)
├─ src/
│  ├─ app.js                         # wiring: config, refresh timer, handlers
│  ├─ config.js                      # config defaults + normalization
│  ├─ dates.js                       # days in Europe/Paris
│  ├─ i18n.js                        # en / fr / de / es helpers
│  ├─ memory.js                      # invoices already seen (/data)
│  ├─ apptable/
│  │  ├─ client.js                   # AppTable HTTP client (login, tokens, calls)
│  │  ├─ parse.js                    # readers of the API answers
│  │  └─ sync.js                     # one refresh -> snapshot, menu cache + dedup
│  ├─ devices/index.js               # devices, states, transport badges
│  └─ capabilities/
│     ├─ scenes.js                   # scene triggers and actions
│     └─ widgets.js                  # dashboard widgets
├─ docs/                             # user documentation (en, fr, de, es)
├─ test/                             # unit tests (`node --test`), fake AppTable server
├─ gladys-assistant-integration.json # manifest
├─ Dockerfile                        # Node 24 Alpine, read-only rootfs ready
├─ CHANGELOG.md                      # Keep a Changelog, rolled by the Release workflow
├─ CLAUDE.md                         # project rules for coding assistants & contributors
├─ SECURITY.md                       # how to report a vulnerability privately
├─ .github/workflows/ci.yml          # format, lint, tests (Node 22 + 24), store checks, Docker build
├─ .github/workflows/release.yml     # UI-driven release: bump + changelog + tag + build
├─ .github/workflows/build.yml       # multi-arch build (git tag, manual, or called by release)
├─ .github/workflows/github-release.yml # GitHub Release of every version tag
├─ .github/scripts/changelog-release.mjs # rolls the [Unreleased] changelog section
├─ .github/dependabot.yml            # npm weekly, GitHub Actions and Docker monthly
└─ cover.png                         # catalog cover, 800×534 px
```

## Run it locally

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="apptable-elior" \
LOG_LEVEL=debug \
npm start
```

## Quality checks

```bash
npm run format:check   # Prettier
npm run lint           # ESLint
npm test               # node --test — no network, a fake AppTable server and the SDK's fake Gladys
npx github:GladysAssistant/integration-store --skip-image-check .   # store admission checks
```

## Release

1. Describe your changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md).
2. **Actions → Release → Run workflow**, pick `patch`, `minor` or `major` (the very first
   release: `major`, from `0.0.0` to `1.0.0`).
3. The workflow bumps `package.json` and the manifest (`version` + `docker_image`), rolls
   the changelog, tags `vX.Y.Z`, builds the `linux/amd64` + `linux/arm64` image to
   `ghcr.io/prohand/gladys-apptable-elior`, publishes the GitHub Release and runs the
   store checks.

The repository needs the GitHub topic `gladys-assistant-integration` to be indexed by the
store, and the GHCR package must be public.

## License

Apache-2.0
