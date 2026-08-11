/**
 * "Print External Labels" in the per-row menu (Phase 2).
 *
 * Harder than the toolbar button, for two reasons:
 *
 *   1. The menu is rendered in a portal appended to document.body, not inside
 *      the row. Nothing in the open menu says which row it belongs to, so the
 *      row is remembered from the click on the row's own menu button and
 *      matched to the menu that appears immediately afterwards.
 *   2. It only exists while open, and is destroyed on close.
 *
 * Everything here fails closed: if the menu is not recognised, no item is
 * added and the toolbar button is untouched. It can also be switched off
 * entirely from the options page.
 */
(function (root) {
  'use strict';

  var grid = root.InnergyLabels.grid;

  var ITEM_MARKER = 'data-innergy-external-labels-item';
  var ITEM_LABEL = 'Print External Labels';

  // How long after clicking the row's menu button a new menu is still assumed
  // to belong to that row.
  var CLAIM_WINDOW_MS = 2000;

  var MENU_BUTTON_SELECTOR = [
    '[data-testid="context-menu-button"]',
    '[aria-haspopup="true"]',
    '[class*="ellipsis" i]'
  ].join(',');

  var MENU_SELECTOR = [
    '[role="menu"]',
    '[class*="bp4-menu" i]',
    '[class*="bp3-menu" i]',
    '[class*="popover" i]',
    'ul[class*="menu" i]'
  ].join(',');

  // Menu-specific, deliberately not matching a bare button: the element that
  // opens the menu is itself a popover *target* wrapping a button, and would
  // otherwise look exactly like a menu containing one item.
  var ITEM_SELECTOR = '[role="menuitem"], [class*="menu-item" i], li';

  var pending = null;      // { row, at } - the row whose menu we expect next
  var lastMenuSeen = null; // kept for the diagnostics report

  function isFresh() {
    return pending && (Date.now() - pending.at) <= CLAIM_WINDOW_MS;
  }

  /**
   * The menu's own items, as whole rows.
   *
   * Deliberately the OUTERMOST match, unlike the toolbar button where the
   * innermost element is the one to clone. A Blueprint menu row is
   * `<li><a class="bp4-menu-item">…</a></li>` and both elements match; cloning
   * the inner anchor and inserting it after itself puts two anchors inside one
   * list item, which renders them side by side on the same row.
   */
  function itemsOf(menu) {
    var items = Array.prototype.slice.call(menu.querySelectorAll(ITEM_SELECTOR))
      .filter(function (item) { return !item.hasAttribute(ITEM_MARKER); });

    return items.filter(function (item) {
      return !items.some(function (other) {
        return other !== item && other.contains(item);
      });
    });
  }

  /**
   * Climb to the element that actually forms the row, for menus that wrap each
   * item in a container which is not itself item-shaped. A wrapper holding
   * exactly one child is part of that row; anything holding more is the menu's
   * own layout and must not be cloned.
   */
  function rowElementFor(item, menu) {
    var node = item;
    while (node.parentElement && node.parentElement !== menu && node.parentElement.children.length === 1) {
      node = node.parentElement;
    }
    return node;
  }

  function looksLikeMenu(element) {
    if (!element || element.nodeType !== 1 || !element.matches) return false;
    if (!element.matches(MENU_SELECTOR)) return false;
    if (!grid.isVisible(element)) return false;

    // The menu is rendered in a portal, outside the grid. Anything inside the
    // row itself is part of the trigger, not the menu.
    if (pending && pending.row.contains(element)) return false;

    return itemsOf(element).length > 0;
  }

  /** The menu within a newly added node, if there is one. */
  function findMenuIn(node) {
    if (looksLikeMenu(node)) return node;
    if (!node.querySelectorAll) return null;

    var candidates = node.querySelectorAll(MENU_SELECTOR);
    for (var i = 0; i < candidates.length; i++) {
      if (looksLikeMenu(candidates[i])) return candidates[i];
    }
    return null;
  }

  function setLabel(element, label) {
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

  /**
   * Clone one of the menu's own items so it matches without knowing anything
   * about Innergy's CSS - the same approach the toolbar button uses.
   */
  function buildItem(template, row) {
    var item = template.cloneNode(true);
    item.removeAttribute('id');
    item.removeAttribute('disabled');
    item.setAttribute(ITEM_MARKER, '');

    // The cloned item carries whatever icon it had; swap it for the printer
    // icon the toolbar's print buttons use.
    var icon = item.querySelector('i[class*="fa-"], svg');
    if (icon && icon.className && typeof icon.className === 'string') {
      icon.className = icon.className.replace(
        /fa-(?!solid|regular|light|thin|duotone|brands)[\w-]+/,
        'fa-qrcode'
      );
    }

    setLabel(item, ITEM_LABEL);

    var anchor = item.matches('a[href]') ? item : item.querySelector('a[href]');
    if (anchor) anchor.removeAttribute('href');

    item.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      onItemClick(row);
    }, true);

    return item;
  }

  function closeMenu() {
    // Blueprint popovers close on Escape, which avoids synthesising a click
    // somewhere on the page.
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      bubbles: true
    }));
  }

  function onItemClick(row) {
    closeMenu();

    var printer = root.InnergyLabels.print;
    if (!printer) return;

    var column = grid.findBarcodeColumn(row);
    printer.single(grid.readBarcode(row, column));
  }

  function tryInject(menu) {
    if (!isFresh()) return;
    if (menu.querySelector('[' + ITEM_MARKER + ']')) return;

    var items = itemsOf(menu);
    if (!items.length) return;

    var last = rowElementFor(items[items.length - 1], menu);
    var item = buildItem(last, pending.row);

    if (last.parentElement) {
      last.insertAdjacentElement('afterend', item);
    } else {
      menu.appendChild(item);
    }

    lastMenuSeen = menu.outerHTML;
    pending = null;
  }

  function onDocumentClick(event) {
    var target = event.target;
    if (!target || !target.closest) return;

    var button = target.closest(MENU_BUTTON_SELECTOR);
    if (!button) return;

    var row = grid.findDataRows().filter(function (candidate) {
      return candidate.contains(button);
    })[0];

    // Only the row menu is of interest; the toolbar has its own button.
    if (!row) return;

    pending = { row: row, at: Date.now() };
  }

  function install(enabled) {
    if (!enabled) return;

    document.addEventListener('click', onDocumentClick, true);

    new MutationObserver(function (records) {
      if (!isFresh()) return;

      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          if (added[j].nodeType !== 1) continue;
          var menu = findMenuIn(added[j]);
          if (menu) {
            tryInject(menu);
            return;
          }
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  root.InnergyLabels.rowMenu = {
    install: install,
    lastMenuMarkup: function () { return lastMenuSeen; }
  };
})(self);
