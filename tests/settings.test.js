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
const { routeMatches, DEFAULTS } = settings;

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
