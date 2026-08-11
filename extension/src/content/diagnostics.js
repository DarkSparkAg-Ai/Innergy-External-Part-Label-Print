/**
 * Selector diagnostics.
 *
 * The Innergy grid markup is not documented, so the heuristics in grid.js are
 * best-effort. This dumps exactly what they saw — press Ctrl+Shift+L with rows
 * selected and the report is copied to the clipboard and logged to the console.
 * Paste it to whoever maintains this extension and the selectors can be made
 * exact.
 */
(function (root) {
  'use strict';

  var grid = root.InnergyLabels.grid;
  var barcode = root.InnergyLabels.barcode;
  var ui = root.InnergyLabels.ui;

  var MAX_HTML = 4000;

  function snippet(el) {
    if (!el) return '(not found)';
    var html = el.outerHTML || '';
    return html.length > MAX_HTML ? html.slice(0, MAX_HTML) + '\n... [truncated]' : html;
  }

  function buildReport() {
    var lines = [];
    function section(heading) {
      lines.push('', '=== ' + heading + ' ===');
    }

    lines.push('Innergy External Part Labels — selector diagnostics');
    lines.push('Generated: ' + new Date().toISOString());
    lines.push('URL: ' + location.href);

    section('Native buttons matched');
    var nativeButtons = grid.findNativeButtons();
    if (!nativeButtons.length) {
      lines.push('(none — the toolbar was not found, so no button was injected)');
    } else {
      nativeButtons.forEach(function (button) {
        lines.push('- <' + button.tagName.toLowerCase() + '> "' + grid.textOf(button) + '"');
        lines.push('  class: ' + (button.getAttribute('class') || '(none)'));
      });
    }

    section('Toolbar');
    var found = grid.findToolbar();
    lines.push(snippet(found && found.toolbar));

    section('Selected rows');
    var rows = grid.findSelectedRows();
    lines.push('count: ' + rows.length);
    if (rows.length) {
      var columnIndex = grid.findBarcodeColumnIndex(rows[0]);
      lines.push('barcode column index from headers: ' + columnIndex);
      lines.push('');
      lines.push('--- first selected row ---');
      lines.push(snippet(rows[0]));
      lines.push('');
      lines.push('--- cells of first selected row ---');
      grid.directCells(rows[0]).forEach(function (cell, index) {
        lines.push(index + ': "' + grid.textOf(cell) + '"');
      });
      lines.push('');
      lines.push('--- barcode read per row ---');
      rows.forEach(function (row, index) {
        var value = grid.readBarcode(row, columnIndex);
        var parsed = barcode.parsePartCode(value);
        lines.push(
          index + ': barcode="' + value + '" -> ' +
          (parsed.ok ? 'partCode=' + parsed.partCode : 'UNPARSEABLE (' + parsed.reason + ')')
        );
      });
    }

    section('Column headers seen');
    var headers = document.querySelectorAll('th, [role="columnheader"]');
    if (!headers.length) {
      lines.push('(none)');
    } else {
      Array.prototype.forEach.call(headers, function (header, index) {
        lines.push(index + ': "' + grid.textOf(header) + '"');
      });
    }

    return lines.join('\n');
  }

  function run() {
    var report = buildReport();
    /* eslint-disable no-console */
    console.log('[Innergy External Labels] diagnostics\n' + report);
    /* eslint-enable no-console */

    navigator.clipboard.writeText(report).then(
      function () {
        ui.showToast({
          tone: 'success',
          title: 'Diagnostics copied to clipboard',
          lines: ['Also written to the browser console. Paste it to whoever maintains this extension.'],
          timeout: 6000
        });
      },
      function () {
        ui.showToast({
          tone: 'warn',
          title: 'Diagnostics written to the console',
          lines: ['The clipboard was blocked. Open DevTools (F12) and copy the report from the Console tab.'],
          timeout: 8000
        });
      }
    );
  }

  /**
   * @param {boolean} withHotkey bind Ctrl+Shift+L as well as the options-page
   *   button. The hotkey is a convenience only — another extension can claim
   *   the same combination, so the options page is the reliable route.
   */
  function install(withHotkey) {
    // Always listen, regardless of the hotkey setting or the current route:
    // this is what the options page's "Collect diagnostics" button calls, and
    // it has to work even when no button was injected.
    chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
      if (!message || message.type !== 'diagnostics') return undefined;
      sendResponse({ ok: true, report: buildReport(), url: location.href });
      return undefined;
    });

    if (!withHotkey) return;

    document.addEventListener('keydown', function (event) {
      if (!event.ctrlKey || !event.shiftKey) return;
      if (String(event.key).toLowerCase() !== 'l') return;
      event.preventDefault();
      run();
    }, true);
  }

  root.InnergyLabels.diagnostics = { install: install, buildReport: buildReport };
})(self);
