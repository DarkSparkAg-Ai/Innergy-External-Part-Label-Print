# Tuning the grid selectors

The extension has to find three things in Innergy's markup:

1. the **multi-edit toolbar**, to put the button in
2. the **selected rows**
3. the **Barcode cell** in each row

None of that is documented by Innergy, and the markup will change over time. So
none of it is hard-coded to an Innergy CSS class — each is discovered at runtime,
strongest signal first. This document explains what it looks for, and what to do
when it stops working.

## How each one is found

### The toolbar

Looks for a visible button whose label is `PRINT PART LABELS` or
`CHANGE STATUS`, then takes the smallest element containing both. The injected
button is a **clone** of `PRINT PART LABELS` with the text swapped, which is why
it matches Innergy's styling and printer icon without knowing anything about
their CSS.

If neither button is found, no button is injected. It fails closed rather than
attaching itself to an arbitrary container.

### The selected rows

Every checked `input[type=checkbox]` (and `[role=checkbox][aria-checked=true]`),
mapped up to its row via `closest()`. Rows are then sorted into document order,
so the print order always matches the grid regardless of the order the user
ticked boxes.

Structural rows are dropped: anything containing a `th`/`columnheader`, anything
in a `thead`, anything with `aria-expanded`, and anything whose class mentions
`group`, `header`, `summary`, `footer` or `filter`. That's what keeps the
select-all box and the project group headers from being treated as parts.

### The Barcode cell

In order:

1. the **override selector** from the options page, if set
2. a cell the grid itself names — `col-id`, `data-field`, `data-colid`,
   `data-column`, `aria-label` or `data-dx-column` containing "barcode"
3. the **column index** of the header cell whose text is exactly `Barcode`
4. any cell whose text is **shaped like a barcode** — no whitespace, at least two
   dashes, and a usable part code after the final dash

Layer 4 means it usually still works even if the header is renamed and the
attributes vanish.

## When it breaks

Symptoms: the button never appears, or clicking it says *"No printable barcodes
in the selection"*.

**Get a diagnostics report first.** Open the grid and tick a few rows, then go to
the extension's options page and click **Collect diagnostics from the Innergy
tab**. The report appears there and is copied to the clipboard.

(There is also a **Ctrl+Shift+L** shortcut on the grid, off by default in effect
because other extensions commonly claim that combination. The options-page button
is the reliable route and works even when no button was injected.)

The report contains:

- which native buttons matched, and their classes
- the toolbar's HTML
- how many selected rows were found
- the first selected row's HTML, and each of its cells with their text
- the barcode read from every selected row, and the part code parsed from it
- every column header seen

That is almost always enough to see what changed.

## Fixing it without a code change

The options page has three override fields under **Advanced**. Any that are set
take priority over the automatic discovery.

| Field | What to put in it | Example |
|---|---|---|
| Toolbar selector | The container the button should be added to | `.multi-edit-toolbar` |
| Grid row selector | Matches one grid row | `tr.k-table-row` |
| Barcode cell selector | Matches the Barcode cell **within a row** | `td[col-id="barcode"]` |

Leave a field blank to keep using auto-discovery for that one — they're
independent, so you can override just the barcode cell and let the toolbar and
rows keep being detected automatically.

To find a selector: right-click the element in Innergy → **Inspect** → in
DevTools right-click the highlighted node → **Copy** → **Copy selector**. Prefer
a stable class or attribute over the long `nth-child` path Chrome gives you, and
sanity-check it in the DevTools console with `document.querySelectorAll('…')`.

## Adding more grids (Phase 3)

Other parts grids elsewhere in Innergy most likely reuse the same toolbar and row
components, so they should need nothing but a page. Add them in the options page
under **Pages**, one per line — pasting the address bar is fine:

```
https://app.innergy.com/#/shipping/parts
#/production/parts
#/jobs/*/parts
```

Every line is reduced to its hash route, so all three forms above are equivalent
to `#/shipping/parts`, `#/production/parts` and `#/jobs/*/parts`. Saving rewrites
the box to those short forms so you can confirm what was understood.

A line with no `*` matches by prefix, so `#/shipping/parts` also covers
`#/shipping/parts/1234`. A line with a `*` must match the whole hash.

If a new grid turns out to be built differently, the override fields above are
the escape hatch — though note they apply to every route, so a grid that needs
different selectors from the others would need a code change to support
per-route overrides.
