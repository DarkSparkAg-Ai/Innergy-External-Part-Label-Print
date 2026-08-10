/**
 * Barcode -> PartCode parsing.
 *
 * Barcode format is [WO]-[ProductID]-[PartCode].
 * The WO itself contains dashes; the PartCode never does.
 * Therefore the PartCode is simply everything after the FINAL dash.
 *
 *   "P-24-1028-010p-2.01-7604HA2K"  ->  "7604HA2K"
 */
(function (root) {
  'use strict';

  // The PartCode becomes a filename ([PartCode].bmp), so reject anything that
  // could not be one. Letters, digits, underscore and dot only.
  var PART_CODE_RE = /^[A-Za-z0-9_.]+$/;

  /**
   * @param {string} barcode raw cell text
   * @returns {{ok: true, partCode: string} | {ok: false, reason: string}}
   */
  function parsePartCode(barcode) {
    if (typeof barcode !== 'string') {
      return { ok: false, reason: 'not a string' };
    }

    var text = barcode.trim();
    if (!text) {
      return { ok: false, reason: 'blank barcode' };
    }

    var lastDash = text.lastIndexOf('-');
    if (lastDash === -1) {
      return { ok: false, reason: 'no dash in barcode' };
    }

    var partCode = text.slice(lastDash + 1).trim();
    if (!partCode) {
      return { ok: false, reason: 'nothing after the final dash' };
    }
    if (!PART_CODE_RE.test(partCode)) {
      return { ok: false, reason: 'part code has unusable characters' };
    }

    return { ok: true, partCode: partCode };
  }

  /**
   * Does this text look like a barcode at all? Used to locate the Barcode
   * column when the header cannot be identified by name.
   * Requires at least two dashes and no whitespace.
   */
  function looksLikeBarcode(text) {
    if (typeof text !== 'string') return false;
    var t = text.trim();
    if (!t || /\s/.test(t)) return false;
    if ((t.match(/-/g) || []).length < 2) return false;
    return /^[A-Za-z0-9_.-]+$/.test(t) && parsePartCode(t).ok;
  }

  /**
   * Parse a list of {barcode, rowLabel} into deduped part codes, preserving
   * the order they were given in (which is grid order, top to bottom).
   *
   * @returns {{partCodes: string[], unparseable: Array<{barcode: string, reason: string}>, duplicates: number}}
   */
  function collectPartCodes(rows) {
    var seen = Object.create(null);
    var partCodes = [];
    var unparseable = [];
    var duplicates = 0;

    rows.forEach(function (row) {
      var result = parsePartCode(row.barcode);
      if (!result.ok) {
        unparseable.push({ barcode: row.barcode || '(empty)', reason: result.reason });
        return;
      }
      var key = result.partCode.toUpperCase();
      if (seen[key]) {
        duplicates += 1;
        return;
      }
      seen[key] = true;
      partCodes.push(result.partCode);
    });

    return { partCodes: partCodes, unparseable: unparseable, duplicates: duplicates };
  }

  root.InnergyLabels = root.InnergyLabels || {};
  root.InnergyLabels.barcode = {
    parsePartCode: parsePartCode,
    looksLikeBarcode: looksLikeBarcode,
    collectPartCodes: collectPartCodes
  };
})(typeof self !== 'undefined' ? self : this);
