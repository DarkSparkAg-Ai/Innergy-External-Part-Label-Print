# Innergy External Part Labels

Adds a **Print External Labels** button to the Innergy parts grid. Select parts,
click it, and the pre-generated `[PartCode].bmp` labels print straight to the
shop's Zebra printer — no print dialog, no opening files by hand.

These "external" labels come from the engineering/CAM software and are unrelated
to Innergy's own **PRINT PART LABELS** button. This tool only looks files up on
a network folder and prints them; it pulls no label data out of Innergy.

---

## How it works

A Chrome extension cannot read a mapped network drive and cannot send anything
to a printer — the browser sandbox forbids both. So there are two pieces:

| Piece | Runs | Does |
|---|---|---|
| **Chrome extension** | The browser | Injects the button, reads the Barcode of each selected row, parses out the PartCode, dedupes, calls the helper, shows the result |
| **Helper app** | Windows, in the background | Finds `[PartCode].bmp`, prints it to the configured Zebra, writes a log |

They talk over `http://127.0.0.1:47113`. The helper is a PowerShell script — every
Windows PC already has PowerShell, so there is no runtime to install and nothing
to compile.

```
Innergy grid ──► extension ──► 127.0.0.1:47113 ──► helper ──► Zebra
   barcode        PartCode                      T:\NC Output\Labels\<PartCode>.bmp
```

### Barcode → PartCode

Barcodes look like `[WO]-[ProductID]-[PartCode]`. The WO contains dashes; the
PartCode never does — so the PartCode is **everything after the final dash**.

```
P-24-1028-010p-2.01-7604HA2K   →   7604HA2K   →   7604HA2K.bmp
```

---

## Installing

### 1. The helper (once per PC)

1. Copy the `helper` folder to the PC.
2. Double-click **`Install.bat`**.
3. Pick the Zebra printer from the numbered list when prompted.

That copies the helper to `%LOCALAPPDATA%\InnergyLabelHelper`, writes a
`config.json`, adds a Startup shortcut so it runs at every login, runs a self
test, and starts it. No administrator rights needed.

To check a PC later, run **`Test-Setup.bat`** — it reports whether the printer
and the label folder are reachable. Pass a part code to print a real test label:

```
Test-Setup.bat 7604HA2K
```

### 2. The extension (once per PC)

Until it's on the Chrome Web Store, load it unpacked:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension` folder.
4. The options page opens. Click **Test connection** — it should report the
   helper's printer and label folder.

---

## Using it

1. Go to the parts grid (`app.innergy.com/#/shipping/parts`).
2. Tick the parts you want labels for. The multi-edit toolbar appears.
3. Click **Print External Labels**.

A toast reports what happened: `Printed 6 of 8 labels` and the names of any
missing `.bmp` files. Labels print in the order the rows appear in the grid, one
per unique PartCode. Over 10 labels, you get a confirm first.

---

## Configuration

### Helper — `%LOCALAPPDATA%\InnergyLabelHelper\config.json`

Everything per-machine lives here. Edit it, then restart the helper (log out and
back in, or re-run `Install.bat`).

| Setting | Default | Meaning |
|---|---|---|
| `printerName` | *(required)* | Exact Windows printer name, as shown in Devices and Printers |
| `labelFolder` | `T:\NC Output\Labels` | Flat folder holding the `.bmp` files |
| `port` | `47113` | Loopback port. Must match the extension's setting |
| `warnThreshold` | `10` | Confirm before printing more than this many labels |
| `scaleMode` | `fit` | `fit` scales the label to the page, `fitDown` only shrinks, `actual` prints at the BMP's own size |
| `autoRotate` | `false` | Turn the label 90° when it would fit the page better |
| `logRetentionDays` | `30` | Delete logs older than this |
| `allowedOrigins` | `["*"]` | See [Security](#security) |

### Extension — its options page

Port, confirm threshold, which pages the button appears on, the diagnostics
collector, and optional selector overrides. Reach it from `chrome://extensions`
→ **Details** → **Extension options**, or by clicking the toolbar icon.

Under **Pages**, paste the address straight from the address bar — a full URL
like `https://app.innergy.com/#/shipping/parts` or just `#/shipping/parts` both
work. Saving rewrites each line to the short form it matched on, so you can see
what it understood.

If the helper is running, **its** `warnThreshold` wins, so the shop only has to
change that number in one place.

---

## Troubleshooting

| What you see | What it means | Fix |
|---|---|---|
| "Label printer helper is not running" | Nothing is listening on the port | Log out and back in, or run `Install.bat` again. Happens after a reboot where nobody signed in |
| "Label folder is not reachable" | The mapped drive is disconnected | Open `T:\NC Output\Labels` in File Explorer to reconnect, then retry |
| "Configured printer was not found" | `printerName` doesn't match Windows | Run `Test-Setup.bat` — it lists the exact installed printer names |
| "Missing label files: …" | Those `.bmp` files aren't in the folder | The labels were never generated. Everything else still printed |
| "No printable barcodes in the selection" | The Barcode column couldn't be read | See [Selector drift](#selector-drift) below |
| The button never appears | Wrong route, or Innergy changed its markup | Check the route list in the options page, then see below |

Logs are at `%LOCALAPPDATA%\InnergyLabelHelper\logs\`, one file per day, with
every request, what printed, what was missing, and any errors — for answering
"did that batch actually go through?"

### Selector drift

Innergy's grid markup isn't documented, so the extension *discovers* the toolbar,
the rows and the Barcode column rather than assuming fixed CSS classes. An
Innergy update can still break that. It fails closed — no button, or nothing
printable — never a wrong label.

Open the Innergy grid, tick a few rows, then go to the extension's options page
and click **Collect diagnostics from the Innergy tab**. It reports exactly what
the extension can see on that page. That report is what's needed to fix it, and
most fixes are just pasting a selector into the options page's **Advanced**
section — no code change. See [docs/SELECTORS.md](docs/SELECTORS.md).

---

## Security

The helper listens on loopback only (`127.0.0.1`), so nothing off the machine can
reach it. Part codes are validated against `[A-Za-z0-9_.]` before touching the
filesystem, so a crafted request can't read outside the label folder.

By default `allowedOrigins` is `["*"]`, meaning any page could ask the helper to
print. On a shop floor that's a nuisance at worst, but to lock it down, put the
extension's ID in `config.json` after installing it (find it on
`chrome://extensions`):

```json
"allowedOrigins": ["chrome-extension://your-extension-id-here"]
```

---

## Status

- **Phase 1 — done.** Toolbar button on `#/shipping/parts`, helper with config,
  folder/printer checks, silent printing, logging, and all the sanity checks.
- **Phase 2 — not built.** The per-row ⋮ menu action. The workaround is one extra
  click: tick the single row and use the toolbar button.
- **Phase 3 — ready, no code needed.** Add more parts-grid routes in the options
  page, one per line; `*` works as a wildcard (e.g. `#/*/parts`).

---

## Development

```bash
cd tests
npm install
npm test          # 61 tests: barcode parsing, grid discovery, injection lifecycle
```

The grid and injection tests run against synthetic Innergy-like grids in both
shapes a parts grid realistically takes — a semantic `<table>` and an ARIA div
grid — including the select-all checkbox, project group headers, and a toolbar
that appears and disappears with the selection.

The helper's HTTP layer, routing, validation and failure paths have their own
PowerShell tests; see [docs/TESTING.md](docs/TESTING.md).

Regenerate the icons with `python3 tools/make-icons.py`.

### Layout

```
extension/
  manifest.json
  src/common/      settings + barcode parsing (shared)
  src/content/     grid discovery, button injection, toasts, diagnostics
  src/background/  the loopback fetch
  src/options/     settings page
helper/
  InnergyLabelHelper.ps1   the helper
  Install.bat              double-click installer
  Test-Setup.bat           per-PC health check
tests/
```
