(function (root) {
  'use strict';

  var settings = root.InnergyLabels.settings;
  var DEFAULTS = settings.DEFAULTS;

  var elements = {};
  ['port', 'warnThreshold', 'routePatterns', 'toolbarSelector', 'rowSelector',
   'barcodeSelector', 'enableRowMenu', 'enableDiagnosticsHotkey', 'save', 'reset', 'status',
   'test', 'test-result', 'collect', 'collect-result', 'collect-report',
   'copy-report'].forEach(function (id) {
    elements[id] = document.getElementById(id);
  });

  function render(values) {
    elements.port.value = values.port;
    elements.warnThreshold.value = values.warnThreshold;
    elements.routePatterns.value = (values.routePatterns || []).join('\n');
    elements.toolbarSelector.value = values.toolbarSelector || '';
    elements.rowSelector.value = values.rowSelector || '';
    elements.barcodeSelector.value = values.barcodeSelector || '';
    elements.enableRowMenu.checked = Boolean(values.enableRowMenu);
    elements.enableDiagnosticsHotkey.checked = Boolean(values.enableDiagnosticsHotkey);
  }

  function readForm() {
    var port = parseInt(elements.port.value, 10);
    var threshold = parseInt(elements.warnThreshold.value, 10);

    if (!port || port < 1 || port > 65535) {
      return { error: 'Port must be a number between 1 and 65535.' };
    }
    if (!threshold || threshold < 1) {
      return { error: 'The confirm threshold must be 1 or more.' };
    }

    // Normalise here so a full URL pasted from the address bar becomes the
    // hash route that matching actually runs against.
    var rawLines = elements.routePatterns.value
      .split('\n')
      .map(function (line) { return line.trim(); })
      .filter(Boolean);

    var routes = rawLines
      .map(settings.normalizeRoute)
      .filter(Boolean);

    if (!rawLines.length) {
      return { error: 'Add at least one page, or the button will never appear.' };
    }
    if (!routes.length) {
      return { error: 'None of those lines look like an Innergy page address.' };
    }

    return {
      values: {
        port: port,
        warnThreshold: threshold,
        routePatterns: routes,
        toolbarSelector: elements.toolbarSelector.value.trim(),
        rowSelector: elements.rowSelector.value.trim(),
        barcodeSelector: elements.barcodeSelector.value.trim(),
        enableRowMenu: elements.enableRowMenu.checked,
        enableDiagnosticsHotkey: elements.enableDiagnosticsHotkey.checked
      }
    };
  }

  function setStatus(message, isError) {
    elements.status.textContent = message;
    elements.status.classList.toggle('error', Boolean(isError));
    if (message) {
      setTimeout(function () {
        if (elements.status.textContent === message) elements.status.textContent = '';
      }, 4000);
    }
  }

  function showTestResult(text, tone) {
    var box = elements['test-result'];
    box.textContent = text;
    box.className = 'result ' + tone;
    box.hidden = false;
  }

  elements.save.addEventListener('click', function () {
    var form = readForm();
    if (form.error) {
      setStatus(form.error, true);
      return;
    }
    settings.save(form.values).then(
      function () {
        // Show what the pages were understood as, so a pasted URL visibly
        // becomes the route it will match on.
        elements.routePatterns.value = form.values.routePatterns.join('\n');
        setStatus('Saved.');
      },
      function (error) { setStatus(error.message, true); }
    );
  });

  elements.reset.addEventListener('click', function () {
    render(DEFAULTS);
    settings.save(DEFAULTS).then(function () { setStatus('Defaults restored.'); });
  });

  elements.test.addEventListener('click', function () {
    var port = parseInt(elements.port.value, 10) || DEFAULTS.port;
    showTestResult('Checking 127.0.0.1:' + port + ' …', '');

    chrome.runtime.sendMessage({ type: 'health', port: port }, function (response) {
      if (chrome.runtime.lastError || !response) {
        showTestResult('The extension could not reach its own background worker. Try reloading the extension.', 'bad');
        return;
      }

      if (!response.ok) {
        showTestResult(
          'No answer on 127.0.0.1:' + port + '.\n\n' +
          'Start the "Innergy Label Helper" on this PC, and check that the port here matches the one in its config.json.',
          'bad'
        );
        return;
      }

      var data = response.data || {};
      var lines = ['Helper is running on port ' + port + '.'];
      if (data.version) lines.push('Version: ' + data.version);
      if (data.printerName) {
        lines.push('Printer: ' + data.printerName + (data.printerFound === false ? '  ** NOT FOUND on this PC **' : ''));
        // A network printer is installed under its full UNC path, so what the
        // helper will actually print to may differ from what is configured.
        if (data.printerFound !== false && data.printerResolved && data.printerResolved !== data.printerName) {
          lines.push('  prints to: ' + data.printerResolved);
        }
      }
      if (data.labelFolder) {
        lines.push('Label folder: ' + data.labelFolder + (data.folderReachable === false ? '  ** NOT REACHABLE **' : ''));
      }
      if (typeof data.warnThreshold === 'number') lines.push('Confirm threshold: ' + data.warnThreshold);

      var healthy = data.printerFound !== false && data.folderReachable !== false;
      showTestResult(lines.join('\n'), healthy ? 'ok' : 'bad');
    });
  });

  function showCollectResult(text, tone) {
    var box = elements['collect-result'];
    box.textContent = text;
    box.className = 'result ' + tone;
    box.hidden = false;
  }

  function showReport(report) {
    elements['collect-report'].value = report;
    elements['collect-report'].hidden = false;
    elements['copy-report'].hidden = false;
  }

  elements.collect.addEventListener('click', function () {
    elements['collect-report'].hidden = true;
    elements['copy-report'].hidden = true;
    showCollectResult('Looking for an Innergy tab…', '');

    chrome.tabs.query({ url: 'https://app.innergy.com/*' }, function (tabs) {
      if (chrome.runtime.lastError) {
        showCollectResult('Could not look at your tabs: ' + chrome.runtime.lastError.message, 'bad');
        return;
      }

      if (!tabs || !tabs.length) {
        showCollectResult(
          'No Innergy tab is open.\n\nOpen the parts grid at app.innergy.com, tick a few rows, then click this again.',
          'bad'
        );
        return;
      }

      var tab = tabs[0];
      chrome.tabs.sendMessage(tab.id, { type: 'diagnostics' }, function (response) {
        if (chrome.runtime.lastError || !response || !response.ok) {
          showCollectResult(
            'The Innergy tab did not answer.\n\n' +
            'That usually means the extension was reloaded after the tab was opened. ' +
            'Reload the Innergy tab (F5) and click this again.\n\n' +
            'Tab: ' + (tab.url || '(unknown)'),
            'bad'
          );
          return;
        }

        showCollectResult('Collected from: ' + response.url, 'ok');
        showReport(response.report);

        navigator.clipboard.writeText(response.report).then(
          function () { setStatus('Diagnostics copied to the clipboard.'); },
          function () { /* the textarea below is the fallback */ }
        );
      });
    });
  });

  elements['copy-report'].addEventListener('click', function () {
    elements['collect-report'].select();
    navigator.clipboard.writeText(elements['collect-report'].value).then(
      function () { setStatus('Copied.'); },
      function () { setStatus('Could not copy — select the text and copy it manually.', true); }
    );
  });

  settings.load().then(render);
})(self);
