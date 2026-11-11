/*
 * Label Snip: finds the shipping label on each PDF page and trims the page to it.
 *
 * The label is the largest image drawn on the page. Only the page boxes change,
 * so the label itself is never re-rendered or recompressed and barcodes stay sharp.
 *
 * Works in the browser (sets self.LabelCrop) and in Node (exports a factory that
 * takes the pdf-lib module) so the same code runs in the extension and the tests.
 */
(function (root) {
  'use strict';

  function makeLabelCrop(PDFLib) {
    const { PDFDocument, PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream, degrees } = PDFLib;

    const IDENTITY = [1, 0, 0, 1, 0, 0];
    const MAX_FORM_DEPTH = 5;
    const MIN_LABEL_SIDE = 72; // 1 inch; smaller images are logos or QR codes, not labels
    const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

    const NAME = {
      Contents: PDFName.of('Contents'),
      XObject: PDFName.of('XObject'),
      Subtype: PDFName.of('Subtype'),
      Image: PDFName.of('Image'),
      Form: PDFName.of('Form'),
      Matrix: PDFName.of('Matrix'),
      Resources: PDFName.of('Resources'),
    };

    class LabelNotFoundError extends Error {
      constructor() {
        super('No shipping label found in this PDF.');
        this.name = 'LabelNotFoundError';
      }
    }

    class NotAPdfError extends Error {
      constructor() {
        super('This file is not a PDF.');
        this.name = 'NotAPdfError';
      }
    }

    // PDFs start with "%PDF-", though some servers add a few junk bytes before it.
    function looksLikePdf(bytes) {
      const end = Math.min(bytes.length - 4, 1024);
      for (let i = 0; i < end; i++) {
        if (bytes[i] === 37 && bytes[i + 1] === 80 && bytes[i + 2] === 68 && bytes[i + 3] === 70 && bytes[i + 4] === 45) return true;
      }
      return false;
    }

    const isWhite = (c) => c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
    const isDelim = (c) =>
      c === 37 || c === 40 || c === 41 || c === 47 || c === 60 || c === 62 ||
      c === 91 || c === 93 || c === 123 || c === 125;

    function ascii(bytes, start, end) {
      let s = '';
      for (let k = start; k < end; k++) s += String.fromCharCode(bytes[k]);
      return s;
    }

    // Inline images (BI ... ID <binary> EI) hold raw bytes that must not be tokenized.
    function skipInlineImage(bytes, i) {
      const n = bytes.length;
      const isWord = (k, a, b) =>
        bytes[k] === a && bytes[k + 1] === b && isWhite(bytes[k - 1]) && (k + 2 >= n || isWhite(bytes[k + 2]));
      while (i < n - 1 && !isWord(i, 73, 68)) i++; // "ID"
      i += 3;
      while (i < n - 1 && !isWord(i, 69, 73)) i++; // "EI"
      return Math.min(i + 2, n);
    }

    // Splits a content stream into numbers, names and operators. Strings,
    // arrays and dicts are reported as "other" since only cm/q/Q/Do matter here.
    function* tokenize(bytes) {
      const n = bytes.length;
      let i = 0;
      while (i < n) {
        const c = bytes[i];
        if (isWhite(c)) { i++; continue; }
        if (c === 37) { // % comment
          while (i < n && bytes[i] !== 10 && bytes[i] !== 13) i++;
          continue;
        }
        if (c === 40) { // (literal string), may nest and contain escapes
          let depth = 0;
          for (; i < n; i++) {
            const d = bytes[i];
            if (d === 92) { i++; continue; }
            if (d === 40) depth++;
            else if (d === 41 && --depth === 0) { i++; break; }
          }
          yield { type: 'other' };
          continue;
        }
        if (c === 60) {
          if (bytes[i + 1] === 60) i += 2; // <<
          else { while (i < n && bytes[i] !== 62) i++; i++; } // <hex string>
          yield { type: 'other' };
          continue;
        }
        if (c === 62) { i += bytes[i + 1] === 62 ? 2 : 1; yield { type: 'other' }; continue; }
        if (c === 41 || c === 91 || c === 93 || c === 123 || c === 125) { i++; yield { type: 'other' }; continue; }

        let j = c === 47 ? i + 1 : i;
        while (j < n && !isWhite(bytes[j]) && !isDelim(bytes[j])) j++;
        const word = ascii(bytes, i, j);
        i = j;
        if (c === 47) { yield { type: 'name', value: word.slice(1) }; continue; }
        if (NUMBER.test(word)) { yield { type: 'number', value: parseFloat(word) }; continue; }
        if (word === 'BI') i = skipInlineImage(bytes, i);
        yield { type: 'op', value: word };
      }
    }

    // PDF matrices are [a b c d e f]. multiply(m, n) applies m first, then n.
    function multiply(m, n) {
      return [
        m[0] * n[0] + m[1] * n[2],
        m[0] * n[1] + m[1] * n[3],
        m[2] * n[0] + m[3] * n[2],
        m[2] * n[1] + m[3] * n[3],
        m[4] * n[0] + m[5] * n[2] + n[4],
        m[4] * n[1] + m[5] * n[3] + n[5],
      ];
    }

    // Images are drawn into the unit square, so their placement is the CTM applied to it.
    function boundsOfUnitSquare(m) {
      const xs = [m[4], m[0] + m[4], m[2] + m[4], m[0] + m[2] + m[4]];
      const ys = [m[5], m[1] + m[5], m[3] + m[5], m[1] + m[3] + m[5]];
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
    }

    function intersect(a, b) {
      const x = Math.max(a.x, b.x);
      const y = Math.max(a.y, b.y);
      const width = Math.min(a.x + a.width, b.x + b.width) - x;
      const height = Math.min(a.y + a.height, b.y + b.height) - y;
      return width > 0 && height > 0 ? { x, y, width, height } : null;
    }

    const round = (v) => Math.round(v * 1000) / 1000;

    function lookupAs(context, obj, Type) {
      const value = obj === undefined ? undefined : context.lookup(obj);
      return value instanceof Type ? value : undefined;
    }

    function streamBytes(stream) {
      return decodePDFRawStream(stream).decode();
    }

    function pageContentBytes(page) {
      const context = page.doc.context;
      const contents = page.node.get(NAME.Contents);
      const list = lookupAs(context, contents, PDFArray);
      const refs = list ? list.asArray() : contents ? [contents] : [];
      const parts = refs.map((r) => lookupAs(context, r, PDFRawStream)).filter(Boolean).map(streamBytes);

      // Join with a newline so tokens at the end of one stream don't merge with the next.
      const total = parts.reduce((sum, p) => sum + p.length + 1, 0);
      const out = new Uint8Array(total);
      let offset = 0;
      for (const p of parts) { out.set(p, offset); offset += p.length; out[offset++] = 10; }
      return out;
    }

    function readMatrix(context, dict) {
      const arr = lookupAs(context, dict.get(NAME.Matrix), PDFArray);
      if (!arr) return IDENTITY;
      const m = arr.asArray().map((v) => {
        const num = lookupAs(context, v, PDFNumber);
        return num ? num.asNumber() : NaN;
      });
      return m.length === 6 && m.every(Number.isFinite) ? m : IDENTITY;
    }

    // Walks a content stream tracking the transform, and records where each image lands.
    function collectImages(context, bytes, resources, ctm, found, depth) {
      const saved = [];
      let operands = [];
      for (const tok of tokenize(bytes)) {
        if (tok.type !== 'op') { operands.push(tok); continue; }
        if (tok.value === 'q') {
          saved.push(ctm);
        } else if (tok.value === 'Q') {
          if (saved.length) ctm = saved.pop();
        } else if (tok.value === 'cm') {
          const m = operands.slice(-6).map((o) => o.value);
          if (m.length === 6 && m.every((v) => typeof v === 'number')) ctm = multiply(m, ctm);
        } else if (tok.value === 'Do') {
          const last = operands[operands.length - 1];
          if (last && last.type === 'name') drawXObject(context, last.value, resources, ctm, found, depth);
        }
        operands = [];
      }
    }

    function drawXObject(context, name, resources, ctm, found, depth) {
      const xobjects = resources && lookupAs(context, resources.get(NAME.XObject), PDFDict);
      const xobject = xobjects && lookupAs(context, xobjects.get(PDFName.of(name)), PDFRawStream);
      if (!xobject) return;

      const subtype = xobject.dict.get(NAME.Subtype);
      if (subtype === NAME.Image) {
        found.push(boundsOfUnitSquare(ctm));
      } else if (subtype === NAME.Form && depth < MAX_FORM_DEPTH) {
        const formCtm = multiply(readMatrix(context, xobject.dict), ctm);
        const formResources = lookupAs(context, xobject.dict.get(NAME.Resources), PDFDict) || resources;
        collectImages(context, streamBytes(xobject), formResources, formCtm, found, depth + 1);
      }
    }

    // Returns the label's box in page coordinates, or null if the page has no label.
    function findLabelBox(page) {
      const context = page.doc.context;
      const images = [];
      collectImages(context, pageContentBytes(page), page.node.Resources(), IDENTITY, images, 0);

      const media = page.getMediaBox();
      let best = null;
      for (const rect of images) {
        const visible = intersect(rect, media);
        if (visible && (!best || visible.width * visible.height > best.width * best.height)) best = visible;
      }
      if (!best || best.width < MIN_LABEL_SIDE || best.height < MIN_LABEL_SIDE) return null;
      return { x: round(best.x), y: round(best.y), width: round(best.width), height: round(best.height) };
    }

    // Takes the label PDF bytes and returns a PDF with one page per label, each
    // trimmed to the label and turned upright (portrait).
    async function cropLabelPdf(bytes) {
      if (!looksLikePdf(bytes)) throw new NotAPdfError();
      const doc = await PDFDocument.load(bytes, { updateMetadata: false });
      const pages = doc.getPages();
      const labels = pages.map((page) => findLabelBox(page));
      if (!labels.some(Boolean)) throw new LabelNotFoundError();

      for (let i = pages.length - 1; i >= 0; i--) {
        if (!labels[i]) doc.removePage(i);
      }

      const results = [];
      pages.forEach((page, i) => {
        const box = labels[i];
        if (!box) return;
        page.setMediaBox(box.x, box.y, box.width, box.height);
        page.setCropBox(box.x, box.y, box.width, box.height);
        page.setBleedBox(box.x, box.y, box.width, box.height);
        page.setTrimBox(box.x, box.y, box.width, box.height);
        page.setArtBox(box.x, box.y, box.width, box.height);

        const rotation = ((page.getRotation().angle % 360) + 360) % 360;
        const sideways = rotation % 180 !== 0;
        const shownWidth = sideways ? box.height : box.width;
        const shownHeight = sideways ? box.width : box.height;
        if (shownWidth > shownHeight) page.setRotation(degrees((rotation + 90) % 360));

        results.push({ ...box, widthIn: round(box.width / 72), heightIn: round(box.height / 72) });
      });

      doc.setTitle('Shipping label (4x6)', { showInWindowTitleBar: true });
      const pdfBytes = await doc.save();
      return { pdfBytes, labels: results };
    }

    return { cropLabelPdf, findLabelBox, LabelNotFoundError, NotAPdfError };
  }

  if (typeof module === 'object' && module.exports) module.exports = makeLabelCrop;
  else root.LabelCrop = makeLabelCrop(root.PDFLib);
})(typeof self !== 'undefined' ? self : this);
