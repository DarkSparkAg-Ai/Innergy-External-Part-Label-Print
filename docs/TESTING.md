# Testing

Two suites: one for the extension, one for the helper.

## Extension — 61 tests

```bash
cd tests
npm install
npm test
```

Node's built-in test runner plus jsdom. No browser needed.

| File | Covers |
|---|---|
| `barcode.test.js` | Barcode → PartCode parsing: dashes in the WO, dedupe order, case-insensitive dedupe, and rejecting anything that couldn't be a filename |
| `grid.test.js` | Toolbar, row and Barcode-cell discovery, run against **both** grid shapes |
| `injection.test.js` | The full click-to-print flow, and the toolbar appear/disappear lifecycle |
| `settings.test.js` | Route matching, and that the extension and helper agree on the default port |

`fixtures.js` builds two synthetic Innergy-like grids — a semantic `<table>` and
an ARIA div grid like ag-Grid or Kendo render — because the real markup isn't
documented and the discovery logic has to survive either. Both carry the awkward
bits the spec calls out: a select-all checkbox in the header, a project group
header row, and a toolbar that only exists while rows are selected.

jsdom does no layout, so `getClientRects()` returns nothing and the production
visibility check would reject the entire page. `fixtures.js` installs a small
shim that treats an element as laid out unless it or an ancestor is
`display:none` or `[hidden]` — enough for the visibility filtering itself to be
under test.

Notable cases:

- **Re-injection after the toolbar is destroyed and recreated.** The spec's #1
  trap; a build that looks for the toolbar once at page load silently does
  nothing.
- **Fails closed on a rename.** If Innergy renames its buttons, no button is
  injected rather than one attached to an arbitrary container.
- **Grid order, not click order.** Ticking row 3 then row 1 prints 1 then 3.
- **Structural rows are never parts.** Select-all and group headers are excluded,
  and aren't reported as unreadable barcodes either.
- **Each helper failure gets its own message** — helper down, folder unreachable,
  printer missing.

## Helper — 41 checks

```powershell
powershell -ExecutionPolicy Bypass -File tests\helper\Run-Tests.ps1
```

`serve-stub.ps1` pulls the helper's functions out of `InnergyLabelHelper.ps1` via
its AST and replaces only `Get-InstalledPrinters` and `Invoke-PrintBitmap`. So the
request parsing, routing, validation, ordering, dedupe, error codes and logging
under test are the real production code — only the spooler call is faked.

The stub server runs as a separate process the test kills by PID. (`Stop-Job`
deadlocks against a job parked in `AcceptTcpClient`.)

Covers: `/health`, the CORS preflight, print ordering, dedupe, missing files,
path-traversal rejection, malformed JSON, unknown endpoints, single-element JSON
array shape, a label the printer rejects mid-batch, log contents, and the two
setup failures that need distinct handling — `FOLDER_UNREACHABLE` vs.
`PRINTER_NOT_FOUND`.

Uses `HttpClient` rather than `Invoke-WebRequest` so it runs on Windows
PowerShell 5.1, where `Invoke-WebRequest` throws on any non-2xx response.

## What is not covered

Two things can't be tested away from a real machine, and both need a hands-on
check on the first PC:

1. **Actual printing.** `System.Drawing.Printing` is Windows-only, so every test
   here stubs the spool call. Whether a BMP lands on the Zebra at the right size
   and orientation has to be confirmed with a real label:

   ```
   Test-Setup.bat 7604HA2K
   ```

   If it comes out scaled wrong, adjust `scaleMode` in `config.json` (`fit`,
   `fitDown`, `actual`); if it's sideways, set `autoRotate` to `true`.

2. **Innergy's real DOM.** The fixtures are informed guesses. The discovery
   heuristics are layered so they degrade rather than break, and they fail closed
   when they can't find something — but the first run against the live grid is
   the real test. Press **Ctrl+Shift+L** there and see
   [SELECTORS.md](SELECTORS.md).
