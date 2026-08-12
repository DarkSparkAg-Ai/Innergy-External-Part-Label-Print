/**
 * Extension settings, shared by the content script, the service worker and the
 * options page.
 *
 * The helper app owns printerName and labelFolder (they are per-machine, and
 * live in its config.json). The extension only stores what the browser side
 * needs. warnThreshold is duplicated here as a fallback: when the helper is
 * reachable its value wins, so the shop has one place to change it.
 */
(function (root) {
  'use strict';

  var DEFAULTS = {
    // Must match "port" in the helper's config.json.
    port: 47113,

    // Confirm before printing more than this many labels.
    warnThreshold: 10,

    // Hash routes to inject the button on. Supports * as a wildcard, so
    // Phase 3 grids can be added here without a code change.
    routePatterns: [
      '#/shipping/parts',
      // Per work order. Both ids are GUIDs, hence the wildcards.
      '#/projects/*/workOrder/*/shipment-items/parts'
    ],

    // Bumped when routePatterns gains an entry, so installs that already
    // saved their settings pick it up. Stored settings otherwise win over
    // defaults, and the new route would never reach anyone.
    routeDefaultsVersion: 0,

    // Optional manual selector overrides. Leave blank to use auto-discovery;
    // fill in if an Innergy update breaks the heuristics.
    toolbarSelector: '',
    rowSelector: '',
    barcodeSelector: '',

    // Add the action to each row's own menu as well as the toolbar. The menu
    // only exists while open and is more exposed to Innergy changing its
    // markup, so it can be turned off without affecting the toolbar button.
    enableRowMenu: true,

    // Optional Ctrl+Shift+L shortcut for the diagnostics report. The options
    // page button is the reliable route, since other extensions commonly claim
    // this combination.
    enableDiagnosticsHotkey: true
  };

  // Raise alongside any addition to DEFAULTS.routePatterns.
  var ROUTE_DEFAULTS_VERSION = 2;

  /**
   * Add routes that shipped as defaults after this install saved its settings.
   *
   * Only ever adds: a route the user deliberately deleted stays deleted for
   * this version, and their own additions are untouched.
   *
   * @returns {object|null} values to persist, or null when nothing changed
   */
  function migrateRoutes(values) {
    if (values.routeDefaultsVersion >= ROUTE_DEFAULTS_VERSION) return null;

    var merged = (values.routePatterns || []).slice();
    var seen = merged.map(normalizeRoute);

    DEFAULTS.routePatterns.forEach(function (pattern) {
      if (seen.indexOf(normalizeRoute(pattern)) === -1) merged.push(pattern);
    });

    return { routePatterns: merged, routeDefaultsVersion: ROUTE_DEFAULTS_VERSION };
  }

  function load() {
    return new Promise(function (resolve) {
      chrome.storage.sync.get(DEFAULTS, function (stored) {
        if (chrome.runtime.lastError) {
          resolve(Object.assign({}, DEFAULTS));
          return;
        }

        var values = Object.assign({}, DEFAULTS, stored);
        var migrated = migrateRoutes(values);

        if (!migrated) {
          resolve(values);
          return;
        }

        Object.assign(values, migrated);
        chrome.storage.sync.set(migrated, function () { resolve(values); });
      });
    });
  }

  function save(values) {
    return new Promise(function (resolve, reject) {
      chrome.storage.sync.set(values, function () {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    });
  }

  /**
   * Reduce anything route-shaped to a bare hash route.
   *
   * Innergy is a hash-route SPA, so matching happens on location.hash. But the
   * natural thing to put in the options page is whatever is in the address
   * bar, so a full URL has to work too. All of these normalise to
   * "#/shipping/parts":
   *
   *   https://app.innergy.com/#/shipping/parts
   *   #/shipping/parts
   *   /shipping/parts
   *   shipping/parts
   */
  function normalizeRoute(value) {
    var text = String(value == null ? '' : value).trim();
    if (!text) return '';

    var hashAt = text.indexOf('#');
    if (hashAt !== -1) {
      text = text.slice(hashAt + 1);
    } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
      // A full URL with no hash at all — keep its path.
      text = text.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
    }

    text = text.replace(/^\/+/, '').replace(/\/+$/, '');
    return text ? '#/' + text : '';
  }

  /**
   * Does the current route match one of the configured patterns?
   *
   * A pattern matches the hash exactly, or as a prefix ending at a "/" or "?"
   * boundary — so "#/shipping/parts" covers "#/shipping/parts/1234" and
   * "#/shipping/parts?page=2", but not "#/shipping/parts-archive".
   *
   * "*" matches any run of characters, for the ids in routes like
   * "#/projects/<guid>/workOrder/<guid>/shipment-items/parts". The boundary
   * rule applies to wildcard patterns too, so a sub-route or a query string
   * appended by Innergy does not stop the button appearing.
   */
  function routeMatches(hash, patterns) {
    var current = normalizeRoute(hash);
    if (!current) return false;

    return (patterns || []).some(function (pattern) {
      var normalized = normalizeRoute(pattern);
      if (!normalized) return false;

      var escaped = normalized
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '[^?]*');

      return new RegExp('^' + escaped + '($|[/?])', 'i').test(current);
    });
  }

  root.InnergyLabels = root.InnergyLabels || {};
  root.InnergyLabels.settings = {
    DEFAULTS: DEFAULTS,
    ROUTE_DEFAULTS_VERSION: ROUTE_DEFAULTS_VERSION,
    migrateRoutes: migrateRoutes,
    load: load,
    save: save,
    routeMatches: routeMatches,
    normalizeRoute: normalizeRoute
  };
})(self);
