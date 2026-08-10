/**
 * Talks to the local helper app.
 *
 * The fetch lives here rather than in the content script on purpose. The
 * Innergy page is https, so a request it made to http://127.0.0.1 would be
 * blocked as mixed content, and it would also be subject to Private Network
 * Access checks. The extension's own origin is a secure context and holds
 * host_permissions for loopback, so the request succeeds from here.
 */

var HEALTH_TIMEOUT_MS = 4000;
var PRINT_TIMEOUT_MS = 120000;

function helperUrl(port, path) {
  // 127.0.0.1 rather than localhost: on some machines "localhost" resolves to
  // ::1 first, and the helper only listens on IPv4.
  return 'http://127.0.0.1:' + port + path;
}

function fetchWithTimeout(url, options, timeoutMs) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, timeoutMs);

  return fetch(url, Object.assign({}, options, { signal: controller.signal }))
    .finally(function () { clearTimeout(timer); });
}

function callHelper(port, path, body, timeoutMs) {
  var options = body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : { method: 'GET' };

  return fetchWithTimeout(helperUrl(port, path), options, timeoutMs)
    .then(function (response) {
      return response.json().then(
        function (data) {
          if (!response.ok && !data) {
            return { ok: false, kind: 'http', error: 'Helper returned HTTP ' + response.status };
          }
          return { ok: true, data: data };
        },
        function () {
          return { ok: false, kind: 'http', error: 'Helper returned an unreadable response (HTTP ' + response.status + ')' };
        }
      );
    })
    .catch(function (error) {
      // A refused connection, a DNS failure or our own abort all mean the same
      // thing to the user: the helper is not answering.
      return {
        ok: false,
        kind: 'unreachable',
        error: error && error.name === 'AbortError' ? 'The helper did not respond in time.' : String(error && error.message || error)
      };
    });
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || !message.type) return undefined;

  if (message.type === 'health') {
    callHelper(message.port, '/health', null, HEALTH_TIMEOUT_MS).then(sendResponse);
    return true;
  }

  if (message.type === 'print') {
    callHelper(message.port, '/print', { partCodes: message.partCodes }, PRINT_TIMEOUT_MS).then(sendResponse);
    return true;
  }

  return undefined;
});

chrome.runtime.onInstalled.addListener(function (details) {
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
});

chrome.action.onClicked.addListener(function () {
  chrome.runtime.openOptionsPage();
});
