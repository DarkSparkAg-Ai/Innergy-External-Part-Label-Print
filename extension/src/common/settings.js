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

    // Ctrl+Shift+L copies a selector diagnostics report.
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
   * Does the current hash route match one of the configured patterns?
   * Patterns are matched against location.hash; "*" matches any run of
   * characters, and a pattern with no wildcard matches by prefix.
   */
  function routeMatches(hash, patterns) {
    var current = hash || '';
    return (patterns || []).some(function (pattern) {
      var trimmed = String(pattern).trim();
      if (!trimmed) return false;

      if (trimmed.indexOf('*') === -1) {
        return current.toLowerCase().indexOf(trimmed.toLowerCase()) === 0;
      }

      var escaped = trimmed.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      return new RegExp('^' + escaped + '$', 'i').test(current);
    });
  }

  root.InnergyLabels = root.InnergyLabels || {};
  root.InnergyLabels.settings = {
    DEFAULTS: DEFAULTS,
    load: load,
    save: save,
    routeMatches: routeMatches
  };
})(self);
