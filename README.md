# Label Snip

Chrome extension that trims a shipping label PDF (a 4×6 label on a letter or A4 page) down to a print-ready 4×6 PDF. Built for Vinted, works on any site whose label is a single picture on the page. Everything runs on your computer.

## Install from source

1. Download or clone this repo.
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick the `extension` folder.
5. Pin it: puzzle-piece icon in the toolbar → pin **Label Snip**.

After changing any file, click the reload ↻ icon on the Label Snip card in `chrome://extensions`.

## Use

1. Open the label so the PDF is showing in a Chrome tab.
2. Click the **Label Snip** icon. A new tab opens with just the 4×6 label.
3. Press **Ctrl+P**, choose your label printer, set paper size to **4 × 6 in** (100mm x 150mm) and scale to **Default / 100%** (not "Fit"), then print.

### New sites

The first time you use it on a site other than Vinted, Label Snip asks "Allow Label Snip to read labels from *site*?". Click **Allow**, then confirm Chrome's own prompt. Chrome words that prompt as "Read and change your data on *site*", which is its standard wording for any site access; Label Snip only downloads the PDF from the tab you clicked.

Chrome remembers the OK. To see or remove approved sites: `chrome://extensions` → Label Snip → **Details** → **Site access**.

If the site only shows the label when you're signed in, that works too: Label Snip uses your existing login.

## What it can't do (yet)

- Labels drawn as text and lines instead of one picture → "Couldn't find a label in this PDF."
- Labels the site builds inside the browser (the tab address starts with `blob:`) → "Label Snip can't read this tab."
- Pages served over plain `http://` → "Label Snip only reads secure (https) pages."

## How it works

- `background.js`: on icon click, opens `crop.html` with the clicked tab's address.
- `crop.js`: asks for the site's OK if needed, downloads the PDF (with your login cookies), calls `labelcrop.js`, shows the result in Chrome's PDF viewer.
- `labelcrop.js`: finds the largest image on each page (the label), shrinks the page boxes to it, turns it upright if it's sideways, and drops pages with no label. The label image isn't re-rendered, so barcodes stay sharp.
- `lib/pdf-lib.js`: [pdf-lib](https://pdf-lib.js.org) 1.17.1 (MIT), unminified so it's easy to read.

Vinted's label host (`svc-shipping-labels.s3.eu-central-1.amazonaws.com`) is approved from install, so Vinted never shows the Allow step.

## Privacy

Label Snip has no server, no account and no analytics. See the [privacy policy](PRIVACY.md).

## Faint prints on a thermal printer

That's a printer setting, not the PDF (Label Snip doesn't change the label image). In Windows → Printers & scanners → your printer → **Printing preferences**, raise **Density** (or Darkness) and lower **Speed**; slower prints darker. If there's a Dither / Threshold option, pick **Threshold**. On a Nelko PL70e-BT these are on the **Parameters** tab (density default 8 of 15, speed default 4).

## License

[MIT](LICENSE). Bundled pdf-lib is also MIT (`extension/lib/pdf-lib.LICENSE.md`).

## Tests

```bash
node --test test/crop.test.js
```

To also check a real label: set `LABEL_SAMPLE` to a label PDF path (and optionally `LABEL_OUT` to save the cropped result).
