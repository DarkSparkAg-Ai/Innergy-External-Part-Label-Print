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
    routePatterns: ['#/shipping/parts'],

    // Optional manual selector overrides. Leave blank to use auto-discovery;
    // fill in if an Innergy update breaks the heuristics.
    toolbarSelector: '',
    rowSelector: '',
    barcodeSelector: '',

    // Optional Ctrl+Shift+L shortcut for the diagnostics report. The options
    // page button is the reliable route, since other extensions commonly claim
    // this combination.
    enableDiagnosticsHotkey: true
  };

  function load() {
    return new Promise(function (resolve) {
      chrome.storage.sync.get(DEFAULTS, function (stored) {
        if (chrome.runtime.lastError) {
          resolve(Object.assign({}, DEFAULTS));
          return;
        }
        resolve(Object.assign({}, DEFAULTS, stored));
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
   * "*" matches any run of characters; a pattern with no wildcard matches by
   * prefix, so "#/shipping/parts" also covers "#/shipping/parts/1234".
   */
  function routeMatches(hash, patterns) {
    var current = normalizeRoute(hash);
    if (!current) return false;

    return (patterns || []).some(function (pattern) {
      var normalized = normalizeRoute(pattern);
      if (!normalized) return false;

      if (normalized.indexOf('*') === -1) {
        return current.toLowerCase().indexOf(normalized.toLowerCase()) === 0;
      }

      var escaped = normalized.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      return new RegExp('^' + escaped + '$', 'i').test(current);
    });
  }

  root.InnergyLabels = root.InnergyLabels || {};
  root.InnergyLabels.settings = {
    DEFAULTS: DEFAULTS,
    load: load,
    save: save,
    routeMatches: routeMatches,
    normalizeRoute: normalizeRoute
  };
})(self);
