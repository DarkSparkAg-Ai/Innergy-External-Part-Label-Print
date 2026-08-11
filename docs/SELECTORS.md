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

**Selections outlive the page they were made on.** Innergy keeps a selection
while you paginate and refilter, but only the current page's rows exist in the
DOM — so reading the DOM at print time would see whichever page you happen to be
on and silently print short.

Instead, the rows on screen are folded into a running set every time the grid
changes or a checkbox is clicked: a ticked row is recorded there and then, while
its barcode is readable. Paginate away and the row leaves the DOM, but the
barcode stays recorded. Untick a row and it is dropped. Clearing the selection —
no toolbar and nothing ticked — empties the set.

This deliberately does **not** read Innergy's own selection model. That model is
not reachable: `DevExpress` is not a global (the grid is bundled through
devextreme-react), and the jQuery plugin is not registered, so getting at it
would mean walking React's fiber tree — coupling the extension to both React and
DevExtreme internals, which would break far more readily than reading the DOM.

Innergy's own **"N selected"** indicator is used as an independent check. If it
agrees with the running set, printing proceeds silently. If it disagrees in
either direction, the user is told and asked to confirm rather than being handed
a batch with the wrong number of labels. Barcodes are re-read every pass rather
than cached, because grids recycle row elements as you page and a stale entry
would print a label for the wrong part.

Structural rows are dropped: anything containing a `th`/`columnheader`, anything
in a `thead`, anything with `aria-expanded`, and anything whose class mentions
`group`, `header`, `summary`, `footer` or `filter`. That's what keeps the
select-all box and the project group headers from being treated as parts.

### The Barcode cell

Innergy's grid is DevExtreme with **frozen columns**, which renders every
logical row *twice*:

- the **main table**, carrying all 33 columns including Barcode
- a **fixed overlay**, carrying only the frozen columns — the select checkbox and
  the row's `⋮` menu — with everything between them collapsed into a single
  `<td colspan="30">` placeholder

The checkbox the user clicks lives in the overlay, so following `closest()` from
it lands on a row with no Barcode cell at all. The two copies are paired by
`aria-rowindex`, and the reader checks every DOM row sharing that index.

Within a row, the Barcode cell is found in order:

1. the **override selector** from the options page, if set
2. a cell the grid itself names — `col-id`, `data-field`, `data-colid`,
   `data-column`, `aria-label` or `data-dx-column` containing "barcode"
3. the cell whose **`aria-colindex`** matches the `Barcode` header's
   (16 on the shipping grid) — preferred over counting positions, because it
   identifies the column even when a row is missing cells
4. the **positional column index** of the header cell whose text is `Barcode`
5. any cell whose text is **shaped like a barcode** — no whitespace, at least two
   dashes, and a usable part code after the final dash

Layer 5 means it usually still works even if the header is renamed and the
attributes vanish.

Note that the headers live in a separate table from the rows, so the search
scope is the nearest ancestor containing *both* — not the row's own table.

### The row's ⋮ menu (Phase 2)

Two things make this harder than the toolbar:

- Blueprint renders the open menu into a **portal appended to `document.body`**,
  so it is detached from the row entirely. Nothing in the menu says which row it
  came from — the row is remembered from the click on its own
  `[data-testid="context-menu-button"]`, and a menu appearing within two seconds
  is taken to belong to it.
- The menu exists **only while open**, so injection is driven by the same
  MutationObserver watching for it to appear.

The item is a **clone of one of the menu's own items**, so it matches Innergy's
styling for free; only the icon is swapped for the printer one. Detection
deliberately requires real menu-item semantics (`[role="menuitem"]`,
`[class*="menu-item"]` or `li`) and ignores anything inside the row itself —
the ⋮ button is wrapped in `bp4-popover2-target`, which otherwise looks like a
popover containing exactly one item.

If the menu is not recognised, no item is added and nothing else is affected.
It can also be turned off in the options page under **Printing**.

> **A caution on row-ish class names.** Row selectors match whole class tokens
> (`[class~="grid-row"]`), not substrings. `dx-datagrid-rowsview` — the container
> holding *every* row — contains the substring `grid-row`, and treating it as a
> row makes it read as the first barcode in the entire grid. `findDataRows` also
> drops any candidate that contains another candidate, since a real row never
> contains another row.

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
