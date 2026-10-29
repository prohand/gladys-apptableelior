// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The store indexer validates the manifest shape, but nothing there knows which
// handlers the code registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ACTIONS, createApp } from '../src/app.js';
import { DEFAULT_CONFIG, REFRESH_BOUNDS } from '../src/config.js';
import {
  BOOKING_CHANGES,
  DAYS,
  SCENE_ACTIONS,
  SCENE_TRIGGERS,
} from '../src/capabilities/scenes.js';
import { WIDGET_KEYS } from '../src/capabilities/widgets.js';
import { LANGUAGES } from '../src/i18n.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

/** The handlers the app registers, read from a fake Gladys. */
function registeredHandlers() {
  const gladys = createFakeGladys();
  createApp(gladys, { fetch: async () => ({ ok: false, status: 503, text: async () => '' }) });
  return gladys.handlers;
}

test('the manifest version, the image tag and package.json move together', () => {
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/prohand/gladys-apptable-elior:${pkg.version}`);
  assert.match(
    manifest.cover_image,
    /^https:\/\/raw\.githubusercontent\.com\/prohand\/gladys-apptable-elior\//,
  );
});

test('every manifest action, scene action and widget has a handler', () => {
  const handlers = registeredHandlers();
  assert.deepEqual(
    manifest.actions.map((action) => action.key),
    Object.values(ACTIONS),
  );
  assert.deepEqual(
    manifest.scene_actions.map((action) => action.key).sort(),
    Object.values(SCENE_ACTIONS).sort(),
  );
  assert.deepEqual(
    manifest.widgets.map((widget) => widget.key).sort(),
    Object.values(WIDGET_KEYS).sort(),
  );
  const keys = [
    ...manifest.actions.map((action) => `action:${action.key}`),
    ...manifest.scene_actions.map((action) => `sceneAction:${action.key}`),
    ...manifest.widgets.map((widget) => `widget:${widget.key}`),
  ];
  for (const key of keys) {
    assert.equal(typeof handlers[key], 'function', `no handler for ${key}`);
  }
});

test('the scene triggers the code fires are the ones the manifest declares', () => {
  assert.deepEqual(
    manifest.scene_triggers.map((trigger) => trigger.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
  const booking = manifest.scene_triggers.find((t) => t.key === SCENE_TRIGGERS.BOOKING_CHANGED);
  const options = (key) =>
    booking.fields
      .find((field) => field.key === key)
      .options.map((option) => option.value)
      .sort();
  assert.deepEqual(options('change'), Object.values(BOOKING_CHANGES).sort());
  assert.deepEqual(options('when'), [DAYS.TODAY, DAYS.TOMORROW].sort());
});

test('the day choices of the scene action and the widget are the ones the code knows', () => {
  const action = manifest.scene_actions.find((a) => a.key === SCENE_ACTIONS.GET_MENU);
  const widget = manifest.widgets.find((w) => w.key === WIDGET_KEYS.MENU);
  for (const field of [
    action.fields.find((f) => f.key === 'day'),
    widget.settings.find((f) => f.key === 'day'),
  ]) {
    assert.deepEqual(
      field.options.map((option) => option.value).sort(),
      Object.values(DAYS).sort(),
    );
    assert.equal(field.default, DAYS.NEXT);
  }
});

const FIELD_TYPES = ['string', 'number', 'boolean', 'select', 'multi_select', 'secret', 'section'];

test('every field uses a type the store accepts', () => {
  const allFields = [
    ...manifest.config_schema,
    ...manifest.actions.flatMap((a) => a.fields ?? []),
    ...manifest.widgets.flatMap((w) => w.settings ?? []),
    ...manifest.scene_triggers.flatMap((t) => t.fields ?? []),
    ...manifest.scene_actions.flatMap((a) => a.fields ?? []),
  ];
  for (const field of allFields) {
    assert.ok(FIELD_TYPES.includes(field.type), `field "${field.key}": type "${field.type}"`);
    assert.match(field.key, /^[a-z0-9_]+$/);
    if (field.placeholder !== undefined) {
      assert.equal(typeof field.placeholder, 'object', `field "${field.key}": placeholder object`);
      assert.ok(['string', 'number', 'secret'].includes(field.type));
    }
    if (field.min !== undefined || field.max !== undefined) {
      assert.equal(field.type, 'number', `field "${field.key}": min/max are number-only`);
    }
    if (field.source !== undefined) {
      assert.equal(field.source, 'devices');
      assert.equal(field.options, undefined, `field "${field.key}": source and options`);
    }
  }
});

test('the password is a secret field, never a plain string', () => {
  const password = manifest.config_schema.find((field) => field.key === 'password');
  assert.equal(password.type, 'secret');
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section') {
      assert.ok(!(field.key in DEFAULT_CONFIG), `section "${field.key}" stores no value`);
      assert.equal(field.required, undefined);
      assert.equal(field.default, undefined);
      for (const link of field.links ?? []) {
        assert.match(link.url, /^https:\/\//);
      }
      continue;
    }
    assert.ok(field.key in DEFAULT_CONFIG, `config key "${field.key}" missing in DEFAULT_CONFIG`);
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `default of ${field.key}`);
    }
  }
  const refresh = manifest.config_schema.find((field) => field.key === 'refresh_minutes');
  assert.deepEqual({ min: refresh.min, max: refresh.max }, REFRESH_BOUNDS);
});

const CATEGORIES = [
  'climate',
  'lighting',
  'energy',
  'security',
  'multimedia',
  'appliances',
  'environment',
  'protocols',
  'network',
  'notifications',
  'assistants',
  'services',
  'transport',
  'vehicles',
  'servers',
  'leisure',
];

test('the catalog fields follow the store rules', () => {
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  for (const category of manifest.categories) {
    assert.ok(CATEGORIES.includes(category), `unknown category "${category}"`);
  }
  const keywords = manifest.keywords.map((keyword) => keyword.trim().toLowerCase());
  assert.ok(keywords.length >= 1 && keywords.length <= 10);
  assert.equal(new Set(keywords).size, keywords.length, 'keywords must be unique');
  for (const keyword of keywords) {
    assert.ok(keyword.length >= 2 && keyword.length <= 30, `keyword "${keyword}"`);
  }
  // AppTable serves French and Monegasque schools only.
  assert.deepEqual(manifest.countries, ['FR', 'MC']);
});

test('AppTable is a cloud service: the manifest says so', () => {
  assert.deepEqual(manifest.transports, ['cloud']);
});

test('the Gladys floor covers every field the manifest declares', () => {
  // widgets and scenes need 5.1, keywords and countries 5.3: an older core
  // rejects a manifest field it does not know.
  const [major, minor] = manifest.gladys_version.replace(/^>=/, '').split('.').map(Number);
  assert.ok(major > 5 || (major === 5 && minor >= 3), `got ${manifest.gladys_version}`);
});

/** Every multi-language object of the manifest, with where it sits. */
function multiLanguageTexts(node, path = 'manifest') {
  if (Array.isArray(node)) {
    return node.flatMap((child, index) => multiLanguageTexts(child, `${path}[${index}]`));
  }
  if (node === null || typeof node !== 'object') {
    return [];
  }
  const keys = Object.keys(node);
  if (keys.includes('en') && keys.every((key) => /^[a-z]{2}$/.test(key))) {
    return [{ path, text: node }];
  }
  return keys.flatMap((key) => multiLanguageTexts(node[key], `${path}.${key}`));
}

test('every multi-language text carries en, fr, de and es', () => {
  const texts = multiLanguageTexts(manifest);
  assert.ok(texts.length > 50, `only ${texts.length} texts found`);
  for (const { path, text } of texts) {
    assert.deepEqual(Object.keys(text).sort(), [...LANGUAGES].sort(), `${path}: languages`);
    for (const language of LANGUAGES) {
      assert.ok(text[language].trim().length > 0, `${path}.${language} is empty`);
    }
  }
});

test('the per-language length limits of the store hold in every language', () => {
  const within = (text, min, max, where) => {
    for (const language of LANGUAGES) {
      const { length } = text[language];
      assert.ok(length >= min && length <= max, `${where}.${language}: ${length} characters`);
    }
  };
  within(manifest.description, 10, 100, 'description');
  for (const widget of manifest.widgets) {
    within(widget.label, 3, 30, `widget ${widget.key} label`);
    within(widget.description, 1, 100, `widget ${widget.key} description`);
  }
  for (const section of manifest.config_schema.filter((field) => field.type === 'section')) {
    within(section.description, 1, 1000, `section ${section.key} description`);
  }
});

test('the user documentation exists in every language', async () => {
  for (const language of LANGUAGES) {
    const text = await readFile(new URL(`../docs/${language}.md`, import.meta.url), 'utf8');
    assert.ok(text.length > 500, `docs/${language}.md is too short`);
  }
});
