(function (root) {
  'use strict';

  var settings = root.InnergyLabels.settings;
  var DEFAULTS = settings.DEFAULTS;

  var elements = {};
  ['port', 'warnThreshold', 'routePatterns', 'toolbarSelector', 'rowSelector',
   'barcodeSelector', 'enableDiagnosticsHotkey', 'save', 'reset', 'status',
   'test', 'test-result'].forEach(function (id) {
    elements[id] = document.getElementById(id);
  });

  function render(values) {
    elements.port.value = values.port;
    elements.warnThreshold.value = values.warnThreshold;
    elements.routePatterns.value = (values.routePatterns || []).join('\n');
    elements.toolbarSelector.value = values.toolbarSelector || '';
    elements.rowSelector.value = values.rowSelector || '';
    elements.barcodeSelector.value = values.barcodeSelector || '';
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

    var routes = elements.routePatterns.value
      .split('\n')
      .map(function (line) { return line.trim(); })
      .filter(Boolean);

    if (!routes.length) {
      return { error: 'Add at least one route, or the button will never appear.' };
    }

    return {
      values: {
        port: port,
        warnThreshold: threshold,
        routePatterns: routes,
        toolbarSelector: elements.toolbarSelector.value.trim(),
        rowSelector: elements.rowSelector.value.trim(),
        barcodeSelector: elements.barcodeSelector.value.trim(),
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
      function () { setStatus('Saved.'); },
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
      }
      if (data.labelFolder) {
        lines.push('Label folder: ' + data.labelFolder + (data.folderReachable === false ? '  ** NOT REACHABLE **' : ''));
      }
      if (typeof data.warnThreshold === 'number') lines.push('Confirm threshold: ' + data.warnThreshold);

      var healthy = data.printerFound !== false && data.folderReachable !== false;
      showTestResult(lines.join('\n'), healthy ? 'ok' : 'bad');
    });
  });

  settings.load().then(render);
})(self);
