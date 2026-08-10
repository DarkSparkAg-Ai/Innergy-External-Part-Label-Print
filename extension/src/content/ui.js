/**
 * Toasts, the over-threshold confirm dialog, and the busy indicator.
 *
 * All of it lives in a shadow root so Innergy's stylesheet cannot restyle our
 * UI and ours cannot leak into their page.
 */
(function (root) {
  'use strict';

  var HOST_ID = 'innergy-external-labels-ui';
  var host = null;
  var shadow = null;

  var STYLES = [
    ':host { all: initial; }',
    '.layer {',
    '  position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;',
    '  font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif;',
    '}',
    '.toasts {',
    '  position: absolute; right: 20px; bottom: 20px;',
    '  display: flex; flex-direction: column; gap: 10px; align-items: flex-end;',
    '}',
    '.toast {',
    '  pointer-events: auto; box-sizing: border-box;',
    '  width: 380px; max-width: calc(100vw - 40px);',
    '  background: #fff; color: #1f2328; border-radius: 6px;',
    '  border-left: 4px solid #57606a;',
    '  box-shadow: 0 8px 28px rgba(0,0,0,.22); padding: 14px 16px;',
    '  animation: slide-in .16s ease-out;',
    '}',
    '.toast.success { border-left-color: #1a7f37; }',
    '.toast.warn    { border-left-color: #bf8700; }',
    '.toast.error   { border-left-color: #cf222e; }',
    '.toast.busy    { border-left-color: #0969da; }',
    '@keyframes slide-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }',
    '.toast-head { display: flex; align-items: flex-start; gap: 10px; }',
    '.toast-title { flex: 1; font-size: 14px; font-weight: 600; line-height: 1.35; }',
    '.toast-close {',
    '  border: 0; background: transparent; cursor: pointer; padding: 0 2px;',
    '  font-size: 17px; line-height: 1; color: #57606a;',
    '}',
    '.toast-close:hover { color: #1f2328; }',
    '.toast-body { margin: 6px 0 0; font-size: 13px; line-height: 1.5; color: #424a53; }',
    '.toast-body p { margin: 0 0 4px; }',
    '.toast-body p:last-child { margin-bottom: 0; }',
    '.toast-body code {',
    '  font-family: ui-monospace, Consolas, monospace; font-size: 12px;',
    '  background: #f0f1f3; border-radius: 3px; padding: 1px 4px; color: #1f2328;',
    '}',
    '.spinner {',
    '  width: 14px; height: 14px; margin-top: 2px; flex: none;',
    '  border: 2px solid #cfd4da; border-top-color: #0969da; border-radius: 50%;',
    '  animation: spin .7s linear infinite;',
    '}',
    '@keyframes spin { to { transform: rotate(360deg); } }',
    '.backdrop {',
    '  position: absolute; inset: 0; pointer-events: auto;',
    '  background: rgba(27,31,36,.45);',
    '  display: flex; align-items: center; justify-content: center;',
    '}',
    '.dialog {',
    '  box-sizing: border-box; width: 420px; max-width: calc(100vw - 40px);',
    '  background: #fff; border-radius: 8px; padding: 22px 24px;',
    '  box-shadow: 0 16px 48px rgba(0,0,0,.3);',
    '}',
    '.dialog h2 { margin: 0 0 8px; font-size: 16px; font-weight: 600; color: #1f2328; }',
    '.dialog p { margin: 0; font-size: 13.5px; line-height: 1.5; color: #424a53; }',
    '.dialog-actions { margin-top: 20px; display: flex; justify-content: flex-end; gap: 8px; }',
    '.dialog button {',
    '  font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;',
    '  padding: 7px 16px; border-radius: 5px; border: 1px solid #d0d7de;',
    '}',
    '.dialog .cancel { background: #f6f8fa; color: #24292f; }',
    '.dialog .cancel:hover { background: #eef1f4; }',
    '.dialog .confirm { background: #0969da; border-color: #0969da; color: #fff; }',
    '.dialog .confirm:hover { background: #0860c4; }'
  ].join('\n');

  function ensureShadow() {
    if (shadow && host && host.isConnected) return shadow;

    host = document.createElement('div');
    host.id = HOST_ID;
    shadow = host.attachShadow({ mode: 'open' });

    var style = document.createElement('style');
    style.textContent = STYLES;

    var layer = document.createElement('div');
    layer.className = 'layer';

    var toasts = document.createElement('div');
    toasts.className = 'toasts';
    layer.appendChild(toasts);

    shadow.append(style, layer);
    document.documentElement.appendChild(host);
    return shadow;
  }

  function toastContainer() {
    return ensureShadow().querySelector('.toasts');
  }

  function paragraphs(lines) {
    var body = document.createElement('div');
    body.className = 'toast-body';
    (lines || []).forEach(function (line) {
      var p = document.createElement('p');
      // Backtick-wrapped fragments render as code; everything else is plain
      // text, so grid content can never inject markup into our UI.
      line.split(/(`[^`]+`)/).forEach(function (chunk) {
        if (!chunk) return;
        if (chunk.charAt(0) === '`' && chunk.charAt(chunk.length - 1) === '`') {
          var code = document.createElement('code');
          code.textContent = chunk.slice(1, -1);
          p.appendChild(code);
        } else {
          p.appendChild(document.createTextNode(chunk));
        }
      });
      body.appendChild(p);
    });
    return body;
  }

  /**
   * @param {{tone?: string, title: string, lines?: string[], timeout?: number, busy?: boolean}} options
   * @returns {{close: function}}
   */
  function showToast(options) {
    var container = toastContainer();

    var toast = document.createElement('div');
    toast.className = 'toast ' + (options.tone || 'info');

    var head = document.createElement('div');
    head.className = 'toast-head';

    if (options.busy) {
      var spinner = document.createElement('div');
      spinner.className = 'spinner';
      head.appendChild(spinner);
    }

    var title = document.createElement('div');
    title.className = 'toast-title';
    title.textContent = options.title;
    head.appendChild(title);

    var timer = null;
    function close() {
      if (timer) clearTimeout(timer);
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }

    if (!options.busy) {
      var closeButton = document.createElement('button');
      closeButton.className = 'toast-close';
      closeButton.type = 'button';
      closeButton.textContent = '×';
      closeButton.setAttribute('aria-label', 'Dismiss');
      closeButton.addEventListener('click', close);
      head.appendChild(closeButton);
    }

    toast.appendChild(head);
    if (options.lines && options.lines.length) {
      toast.appendChild(paragraphs(options.lines));
    }

    container.appendChild(toast);

    if (options.timeout) {
      timer = setTimeout(close, options.timeout);
    }

    return { close: close };
  }

  /**
   * @returns {Promise<boolean>} true when the user confirms
   */
  function showConfirm(options) {
    return new Promise(function (resolve) {
      var layer = ensureShadow().querySelector('.layer');

      var backdrop = document.createElement('div');
      backdrop.className = 'backdrop';

      var dialog = document.createElement('div');
      dialog.className = 'dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');

      var heading = document.createElement('h2');
      heading.textContent = options.title;

      var message = document.createElement('p');
      message.textContent = options.message;

      var actions = document.createElement('div');
      actions.className = 'dialog-actions';

      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'cancel';
      cancel.textContent = options.cancelLabel || 'Cancel';

      var confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'confirm';
      confirm.textContent = options.confirmLabel || 'Continue';

      function settle(value) {
        document.removeEventListener('keydown', onKeydown, true);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        resolve(value);
      }

      function onKeydown(event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          settle(false);
        }
      }

      cancel.addEventListener('click', function () { settle(false); });
      confirm.addEventListener('click', function () { settle(true); });
      backdrop.addEventListener('click', function (event) {
        if (event.target === backdrop) settle(false);
      });
      document.addEventListener('keydown', onKeydown, true);

      actions.append(cancel, confirm);
      dialog.append(heading, message, actions);
      backdrop.appendChild(dialog);
      layer.appendChild(backdrop);

      confirm.focus();
    });
  }

  root.InnergyLabels.ui = {
    showToast: showToast,
    showConfirm: showConfirm
  };
})(self);
