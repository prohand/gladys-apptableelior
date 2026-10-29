# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

Describe each change under `## [Unreleased]` as you make it. The Release workflow
moves that section under the version it ships, and the section becomes the notes of
the version's GitHub Release.

## [Unreleased]

### Added

- First version of the AppTable Elior integration (Elior school canteens).
- One device per child: meal booked today and tomorrow, menu of today and tomorrow.
- One device for the account: amount due and number of invoices to pay.
- Children who eat in the same restaurant and section share one menu: it is fetched
  once and shown once, with their first names together.
- Scene triggers: a new invoice is available, a meal booking changed.
- Scene actions: get a child's menu (today, tomorrow or next meal), refresh now.
- Dashboard widgets: canteen menu, canteen account.
- "Test the connection" button in the Configuration screen.
- English, French, German and Spanish texts and documentation.
- CI (Prettier, ESLint, tests on Node 22 and 24, store checks, Docker build), UI-driven
  release, multi-arch image build, GitHub Releases, Dependabot.

[Unreleased]: https://github.com/prohand/gladys-apptable-elior/commits/main
