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

test('ships pointing at the shipping parts grid', () => {
  assert.deepStrictEqual([...DEFAULTS.routePatterns], ['#/shipping/parts']);
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

test('a wildcard pattern must match the whole hash', () => {
  assert.ok(!routeMatches('#/shipping/parts/detail', ['#/*/parts']));
  assert.ok(routeMatches('#/shipping/parts/detail', ['#/*/parts/*']));
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
