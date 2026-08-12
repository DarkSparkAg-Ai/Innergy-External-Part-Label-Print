const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

function loadSettings() {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'extension', 'src', 'common', 'settings.js'),
    'utf8'
  );
  const root = {};
  new Function('self', code)(root);
  return root.InnergyLabels.settings;
}

const settings = loadSettings();
const { routeMatches, normalizeRoute, DEFAULTS } = settings;

test('a full URL pasted from the address bar is accepted as a page', () => {
  // Pasting the address bar is the obvious thing to do in the options page,
  // and it has to work — matching runs against location.hash, not the URL.
  assert.ok(routeMatches(
    '#/shipping/parts',
    ['https://app.innergy.com/#/shipping/parts']
  ));
});

test('a full URL matches when the current location is also a full URL', () => {
  assert.ok(routeMatches(
    'https://app.innergy.com/#/shipping/parts',
    ['https://app.innergy.com/#/shipping/parts']
  ));
});

test('normalizes every shape of the same route to one form', () => {
  const expected = '#/shipping/parts';
  for (const input of [
    'https://app.innergy.com/#/shipping/parts',
    'http://app.innergy.com/#/shipping/parts',
    '#/shipping/parts',
    '#/shipping/parts/',
    '/shipping/parts',
    'shipping/parts',
    '  #/shipping/parts  '
  ]) {
    assert.strictEqual(normalizeRoute(input), expected, `for input "${input}"`);
  }
});

test('normalizing rubbish yields nothing rather than a bad match', () => {
  for (const input of ['', '   ', '#', '/', null, undefined]) {
    assert.strictEqual(normalizeRoute(input), '');
  }
});

test('mixed URL and hash forms interoperate', () => {
  assert.ok(routeMatches('#/production/parts', ['https://app.innergy.com/#/production/parts']));
  assert.ok(routeMatches('https://app.innergy.com/#/production/parts', ['#/production/parts']));
  assert.ok(routeMatches('https://app.innergy.com/#/shipping/parts', ['shipping/parts']));
});

test('a full URL still respects prefix and wildcard rules', () => {
  assert.ok(routeMatches('#/shipping/parts/1234', ['https://app.innergy.com/#/shipping/parts']));
  assert.ok(routeMatches('#/production/parts', ['https://app.innergy.com/#/*/parts']));
  assert.ok(!routeMatches('#/shipping/orders', ['https://app.innergy.com/#/shipping/parts']));
});

test('ships pointing at both parts grids', () => {
  assert.deepStrictEqual([...DEFAULTS.routePatterns], [
    '#/shipping/parts',
    '#/projects/*/workOrder/*/shipment-items/parts'
  ]);
});

test('matches the per-work-order parts grid for any project and WO', () => {
  // A real URL from the app; both ids are GUIDs and vary per work order.
  const live = 'https://app.innergy.com/#/projects/3a195403-c3b9-4d42-b507-a4a8470d4a48' +
    '/workOrder/dbf01280-726e-47a8-a2de-6806c62d31cd/shipment-items/parts';

  assert.ok(routeMatches(live, DEFAULTS.routePatterns));
  assert.ok(routeMatches(
    '#/projects/00000000-0000-0000-0000-000000000000/workOrder/11111111-2222-3333-4444-555555555555/shipment-items/parts',
    DEFAULTS.routePatterns
  ));
});

test('the work-order route survives a sub-route or query string', () => {
  const base = '#/projects/3a195403-c3b9-4d42-b507-a4a8470d4a48' +
    '/workOrder/dbf01280-726e-47a8-a2de-6806c62d31cd/shipment-items/parts';

  assert.ok(routeMatches(base + '/1234', DEFAULTS.routePatterns));
  assert.ok(routeMatches(base + '?page=2', DEFAULTS.routePatterns));
});

test('does not match neighbouring work-order pages', () => {
  const prefix = '#/projects/3a195403-c3b9-4d42-b507-a4a8470d4a48' +
    '/workOrder/dbf01280-726e-47a8-a2de-6806c62d31cd';

  assert.ok(!routeMatches(prefix + '/shipment-items', DEFAULTS.routePatterns));
  assert.ok(!routeMatches(prefix + '/shipment-items/summary', DEFAULTS.routePatterns));
  assert.ok(!routeMatches('#/projects/3a195403-c3b9-4d42-b507-a4a8470d4a48', DEFAULTS.routePatterns));
});

test('the default port matches the helper default', () => {
  const helper = fs.readFileSync(
    path.join(__dirname, '..', 'helper', 'InnergyLabelHelper.ps1'),
    'utf8'
  );
  const match = helper.match(/port\s*=\s*(\d+)/);
  assert.ok(match, 'could not find the default port in the helper script');
  assert.strictEqual(
    Number(match[1]),
    DEFAULTS.port,
    'extension and helper must agree on the default port'
  );
});

test('matches a route by prefix', () => {
  assert.ok(routeMatches('#/shipping/parts', ['#/shipping/parts']));
  assert.ok(routeMatches('#/shipping/parts?page=2', ['#/shipping/parts']));
  assert.ok(routeMatches('#/shipping/parts/1234', ['#/shipping/parts']));
});

test('does not match an unrelated route', () => {
  assert.ok(!routeMatches('#/shipping/orders', ['#/shipping/parts']));
  assert.ok(!routeMatches('#/production/parts', ['#/shipping/parts']));
  assert.ok(!routeMatches('', ['#/shipping/parts']));
});

test('supports a wildcard for Phase 3 grids', () => {
  const patterns = ['#/*/parts'];
  assert.ok(routeMatches('#/shipping/parts', patterns));
  assert.ok(routeMatches('#/production/parts', patterns));
  assert.ok(!routeMatches('#/shipping/orders', patterns));
});

test('a pattern only matches at a path or query boundary', () => {
  // Prefix matching, but not mid-segment: a route that merely starts with the
  // same letters is a different page.
  assert.ok(routeMatches('#/shipping/parts', ['#/shipping/parts']));
  assert.ok(routeMatches('#/shipping/parts/1234', ['#/shipping/parts']));
  assert.ok(routeMatches('#/shipping/parts?page=2', ['#/shipping/parts']));
  assert.ok(!routeMatches('#/shipping/parts-archive', ['#/shipping/parts']));
});

test('wildcards follow the same boundary rule', () => {
  assert.ok(routeMatches('#/shipping/parts/detail', ['#/*/parts']));
  assert.ok(routeMatches('#/shipping/parts/detail', ['#/*/parts/*']));
  assert.ok(!routeMatches('#/shipping/parts-archive', ['#/*/parts']));
});

test('a wildcard does not swallow a query string', () => {
  assert.ok(!routeMatches('#/shipping/orders?tab=parts', ['#/*/parts']));
});

test('matching ignores case', () => {
  assert.ok(routeMatches('#/Shipping/Parts', ['#/shipping/parts']));
  assert.ok(routeMatches('#/SHIPPING/PARTS', ['#/*/parts']));
});

test('any one of several patterns can match', () => {
  const patterns = ['#/shipping/parts', '#/production/parts', '#/jobs/*/parts'];
  assert.ok(routeMatches('#/production/parts', patterns));
  assert.ok(routeMatches('#/jobs/1028/parts', patterns));
  assert.ok(!routeMatches('#/reports', patterns));
});

test('blank and empty patterns never match', () => {
  assert.ok(!routeMatches('#/shipping/parts', []));
  assert.ok(!routeMatches('#/shipping/parts', ['', '   ']));
  assert.ok(!routeMatches('#/shipping/parts', undefined));
});

test('regex characters in a pattern are treated literally', () => {
  assert.ok(!routeMatches('#/shipping/XXparts', ['#/shipping/.*parts']));
});

// --- route defaults migration -------------------------------------------

test('an install that already saved its settings gains a new default route', () => {
  // Stored settings win over defaults, so without this the work-order grid
  // would never reach anyone who had opened the options page.
  const migrated = settings.migrateRoutes({
    routePatterns: ['#/shipping/parts'],
    routeDefaultsVersion: 0
  });

  assert.ok(migrated, 'expected a migration');
  assert.deepStrictEqual([...migrated.routePatterns], [
    '#/shipping/parts',
    '#/projects/*/workOrder/*/shipment-items/parts'
  ]);
  assert.strictEqual(migrated.routeDefaultsVersion, settings.ROUTE_DEFAULTS_VERSION);
});

test('migration keeps routes the user added themselves', () => {
  const migrated = settings.migrateRoutes({
    routePatterns: ['#/shipping/parts', '#/my/custom/grid'],
    routeDefaultsVersion: 0
  });

  assert.ok(migrated.routePatterns.includes('#/my/custom/grid'));
  assert.ok(migrated.routePatterns.includes('#/projects/*/workOrder/*/shipment-items/parts'));
});

test('migration does not duplicate a route the user already pasted as a URL', () => {
  const migrated = settings.migrateRoutes({
    routePatterns: ['https://app.innergy.com/#/shipping/parts'],
    routeDefaultsVersion: 0
  });

  const shippingRoutes = migrated.routePatterns.filter((p) => /shipping\/parts/.test(p));
  assert.strictEqual(shippingRoutes.length, 1, 'the pasted URL and the default are the same route');
});

test('migration runs only once', () => {
  const first = settings.migrateRoutes({
    routePatterns: ['#/shipping/parts'],
    routeDefaultsVersion: 0
  });

  assert.ok(first);
  assert.strictEqual(settings.migrateRoutes(first), null, 'already migrated');
});

test('a route deliberately removed is not resurrected once migrated', () => {
  const removed = settings.migrateRoutes({
    routePatterns: ['#/shipping/parts'],
    routeDefaultsVersion: settings.ROUTE_DEFAULTS_VERSION
  });

  assert.strictEqual(removed, null);
});
