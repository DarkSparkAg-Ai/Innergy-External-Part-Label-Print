/**
 * Button injection and the print flow.
 *
 * The multi-edit toolbar does not exist at page load — Innergy creates it when
 * the first row checkbox is ticked and destroys it when the selection clears.
 * So injection is driven entirely by a MutationObserver, never by a one-shot
 * lookup at load. The same observer covers hash-route navigation in the SPA.
 */
(function (root) {
  'use strict';

  var settings = root.InnergyLabels.settings;
  var barcode = root.InnergyLabels.barcode;
  var grid = root.InnergyLabels.grid;
  var tracking = root.InnergyLabels.selection;
  var ui = root.InnergyLabels.ui;
  var diagnostics = root.InnergyLabels.diagnostics;

  var BUTTON_MARKER = 'data-innergy-external-labels';
  var BUTTON_LABEL = 'Print External Labels';

  var config = null;
  var helperConfig = null; // filled in from the helper's /health, when reachable
  var printing = false;
  var scheduled = false;

  // ---------------------------------------------------------------------------
  // Button
  // ---------------------------------------------------------------------------

  function setButtonLabel(element, label) {
    var walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
    var textNodes = [];
    var node;
    while ((node = walker.nextNode())) {
      if (node.nodeValue && node.nodeValue.trim()) textNodes.push(node);
    }

    if (!textNodes.length) {
      element.appendChild(document.createTextNode(label));
      return;
    }

    textNodes[0].nodeValue = label;
    for (var i = 1; i < textNodes.length; i++) {
      textNodes[i].nodeValue = '';
    }
  }

  function buildFallbackButton() {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'innergy-external-labels-fallback-button';
    button.textContent = BUTTON_LABEL;
    return button;
  }

  function buildButton(template) {
    var button;

    if (template) {
      // cloneNode does not copy event listeners, so the clone carries Innergy's
      // styling and icon without any of Innergy's behaviour.
      button = template.cloneNode(true);
      button.removeAttribute('id');
      button.removeAttribute('disabled');
      button.removeAttribute('aria-describedby');
      if (button.tagName === 'A') button.removeAttribute('href');
      setButtonLabel(button, BUTTON_LABEL);
    } else {
      button = buildFallbackButton();
    }

    button.setAttribute(BUTTON_MARKER, '');
    button.setAttribute('title', 'Print the pre-generated BMP labels for the selected parts');
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      onPrintClick(button);
    });

    return button;
  }

  function injectInto(found) {
    if (found.toolbar.querySelector('[' + BUTTON_MARKER + ']')) return;

    var button = buildButton(found.template);
    var nativeButtons = grid.findNativeButtons();
    var anchor = nativeButtons[nativeButtons.length - 1];

    if (anchor && found.toolbar.contains(anchor) && anchor.parentElement) {
      anchor.insertAdjacentElement('afterend', button);
    } else {
      found.toolbar.appendChild(button);
    }
  }

  function syncButton() {
    if (!config) return;
    if (!settings.routeMatches(location.hash, config.routePatterns)) return;

    var found = grid.findToolbar();
    if (!found) return;

    injectInto(found);
  }

  // ---------------------------------------------------------------------------
  // Print flow
  // ---------------------------------------------------------------------------

  function warnThreshold() {
    if (helperConfig && typeof helperConfig.warnThreshold === 'number') {
      return helperConfig.warnThreshold;
    }
    return config.warnThreshold;
  }

  function pluralLabels(count) {
    return count + (count === 1 ? ' label' : ' labels');
  }

  function describeSkipped(selection, collected) {
    var lines = [];
    if (selection.unreadableRows) {
      lines.push(
        'Skipped ' + selection.unreadableRows +
        (selection.unreadableRows === 1 ? ' row with no Barcode value.' : ' rows with no Barcode value.')
      );
    }
    if (collected.unparseable.length) {
      lines.push(
        'Skipped ' + collected.unparseable.length +
        (collected.unparseable.length === 1 ? ' unreadable barcode: ' : ' unreadable barcodes: ') +
        collected.unparseable.slice(0, 5).map(function (item) { return '`' + item.barcode + '`'; }).join(', ') +
        (collected.unparseable.length > 5 ? ', …' : '')
      );
    }
    if (collected.duplicates) {
      lines.push('Collapsed ' + collected.duplicates + ' duplicate part ' + (collected.duplicates === 1 ? 'code' : 'codes') + '.');
    }
    return lines;
  }

  function showResult(partCodes, result, skippedLines) {
    var printed = result.printed || [];
    var missing = result.missing || [];
    var lines = [];

    if (missing.length) {
      lines.push(
        'Missing ' + (missing.length === 1 ? 'label file' : 'label files') + ': ' +
        missing.map(function (code) { return '`' + code + '.bmp`'; }).join(', ')
      );
    }

    lines = lines.concat(skippedLines);

    var tone = missing.length ? 'warn' : 'success';
    var title = missing.length
      ? 'Printed ' + printed.length + ' of ' + pluralLabels(partCodes.length)
      : 'Printed ' + pluralLabels(printed.length);

    ui.showToast({
      tone: tone,
      title: title,
      lines: lines,
      timeout: missing.length ? 0 : 5000
    });
  }

  function showHelperError(response) {
    if (response.kind === 'unreachable') {
      ui.showToast({
        tone: 'error',
        title: 'Label printer helper is not running',
        lines: [
          'Start "Innergy Label Helper" on this PC and try again. It normally starts automatically at login, so this usually means the PC was restarted and nobody signed back in.',
          'It should be listening on `127.0.0.1:' + config.port + '`.'
        ]
      });
      return;
    }

    var messages = {
      FOLDER_UNREACHABLE: {
        title: 'Label folder is not reachable',
        lines: [
          'The helper could not open the label folder — the mapped drive is probably disconnected on this PC.',
          'Open the folder in File Explorer to reconnect it, then try again.'
        ]
      },
      PRINTER_NOT_FOUND: {
        title: 'Configured printer was not found',
        lines: [
          'The helper could not find the Zebra printer named in its `config.json`, so nothing was printed.',
          'Check the printer name in Windows under Devices and Printers.'
        ]
      }
    };

    var known = messages[response.errorCode];
    ui.showToast({
      tone: 'error',
      title: known ? known.title : 'The label helper reported an error',
      lines: known ? known.lines : [response.error || 'No detail was returned.']
    });
  }

  function onPrintClick(button) {
    if (printing) return;

    // Catch anything ticked since the last grid mutation before reading.
    tracking.sync();

    var selection = grid.readSelection();
    var tracked = tracking.list();

    if (!tracked.length && !selection.rowCount) {
      ui.showToast({
        tone: 'warn',
        title: 'No rows selected',
        lines: ['Tick the checkbox on the parts you want labels for, then click Print External Labels.'],
        timeout: 6000
      });
      return;
    }

    // The running selection, not just this page's rows.
    var collected = barcode.collectPartCodes(tracked.map(function (value) {
      return { barcode: value };
    }));
    var skippedLines = describeSkipped(selection, collected);

    if (!collected.partCodes.length) {
      ui.showToast({
        tone: 'error',
        title: 'No printable barcodes in the selection',
        // Point at the options page rather than the shortcut: another
        // extension may have claimed Ctrl+Shift+L, and the button always works.
        lines: skippedLines.concat([
          'Nothing was sent to the printer. If this looks wrong, open this extension’s options and click "Collect diagnostics from the Innergy tab".'
        ])
      });
      return;
    }

    // Innergy's own indicator is the independent check on the running
    // selection. Agreement means everything selected was captured; a
    // disagreement is always surfaced rather than quietly printing the wrong
    // number of labels.
    var reported = selection.reportedCount;
    var drift = typeof reported === 'number' ? reported - tracked.length : 0;

    var proceed;
    if (drift > 0) {
      proceed = ui.showConfirm({
        title: 'Only ' + tracked.length + ' of ' + reported + ' selected parts could be read',
        message: 'Innergy reports ' + reported + ' parts selected, but this extension only captured ' +
          tracked.length + '. That happens when rows were already selected before this page was opened. ' +
          'Print the ' + collected.partCodes.length + ' captured, or cancel, clear the selection and select again.',
        confirmLabel: 'Print ' + collected.partCodes.length,
        cancelLabel: 'Cancel'
      });
    } else if (drift < 0) {
      proceed = ui.showConfirm({
        title: 'Selection may be out of date',
        message: 'This extension has ' + tracked.length + ' parts recorded, but Innergy reports only ' +
          reported + ' selected. Print the ' + collected.partCodes.length +
          ' recorded, or cancel, clear the selection and select again.',
        confirmLabel: 'Print ' + collected.partCodes.length,
        cancelLabel: 'Cancel'
      });
    } else if (collected.partCodes.length > warnThreshold()) {
      proceed = ui.showConfirm({
        title: 'Print ' + pluralLabels(collected.partCodes.length) + '?',
        message: 'You are about to print ' + collected.partCodes.length +
          ' labels to the Zebra printer. This cannot be cancelled once it starts.',
        confirmLabel: 'Print',
        cancelLabel: 'Cancel'
      });
    } else {
      proceed = Promise.resolve(true);
    }

    proceed.then(function (confirmed) {
      if (!confirmed) return;
      sendToHelper(button, collected.partCodes, skippedLines);
    });
  }

  function sendToHelper(button, partCodes, skippedLines) {
    printing = true;
    button.setAttribute('disabled', 'disabled');
    button.style.pointerEvents = 'none';
    button.style.opacity = '0.6';

    var busy = ui.showToast({
      busy: true,
      tone: 'busy',
      title: 'Sending ' + pluralLabels(partCodes.length) + ' to the printer…'
    });

    function finish() {
      printing = false;
      button.removeAttribute('disabled');
      button.style.pointerEvents = '';
      button.style.opacity = '';
      busy.close();
    }

    chrome.runtime.sendMessage({ type: 'print', port: config.port, partCodes: partCodes }, function (response) {
      finish();

      if (chrome.runtime.lastError || !response) {
        ui.showToast({
          tone: 'error',
          title: 'The extension could not reach its background worker',
          lines: ['Reload the Innergy tab and try again.']
        });
        return;
      }

      if (!response.ok) {
        showHelperError(response);
        return;
      }

      if (response.data && response.data.error) {
        showHelperError({ errorCode: response.data.errorCode, error: response.data.error });
        return;
      }

      showResult(partCodes, response.data || {}, skippedLines);
    });
  }

  // ---------------------------------------------------------------------------
  // Startup
  // ---------------------------------------------------------------------------

  function refreshHelperConfig() {
    chrome.runtime.sendMessage({ type: 'health', port: config.port }, function (response) {
      if (chrome.runtime.lastError || !response || !response.ok) return;
      helperConfig = response.data || null;
    });
  }

  function scheduleSync() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      try {
        syncButton();
        // Record ticks as they happen, while the rows are still on screen.
        if (settings.routeMatches(location.hash, config.routePatterns)) tracking.sync();
      } catch (error) {
        /* eslint-disable no-console */
        console.error('[Innergy External Labels] injection failed', error);
        /* eslint-enable no-console */
      }
    });
  }

  function start(loaded) {
    config = loaded;
    grid.setOverrides({
      toolbarSelector: config.toolbarSelector,
      rowSelector: config.rowSelector,
      barcodeSelector: config.barcodeSelector
    });

    diagnostics.install(config.enableDiagnosticsHotkey);

    new MutationObserver(scheduleSync).observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    window.addEventListener('hashchange', scheduleSync);

    // Ticking a checkbox is what we most need to notice, and not every grid
    // mutates the DOM when it happens. Listening for the interaction itself is
    // more dependable than waiting for a mutation to fall out of it.
    document.addEventListener('change', scheduleSync, true);
    document.addEventListener('click', scheduleSync, true);
    scheduleSync();
    refreshHelperConfig();

    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'sync') return;
      settings.load().then(function (next) {
        config = next;
        grid.setOverrides({
          toolbarSelector: config.toolbarSelector,
          rowSelector: config.rowSelector,
          barcodeSelector: config.barcodeSelector
        });
        scheduleSync();
      });
    });
  }

  settings.load().then(start);
})(self);
