// Run with:  node --test test/crop.test.js
// Optional real-label check:  LABEL_SAMPLE=path/to/label.pdf LABEL_OUT=out.pdf node --test test/crop.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const zlib = require('node:zlib');

const PDFLib = require('../extension/lib/pdf-lib.js');
const { cropLabelPdf, LabelNotFoundError, NotAPdfError } = require('../extension/labelcrop.js')(PDFLib);
const { PDFDocument, PDFName, StandardFonts, degrees } = PDFLib;

const LETTER_LANDSCAPE = [792, 612];
const VINTED_BOX = { x: 36, y: 90, width: 288, height: 432 };

function makePng(w, h) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // 8-bit grayscale
  const raw = Buffer.alloc((w + 1) * h, 255);
  for (let row = 0; row < h; row++) raw[row * (w + 1)] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function reload(doc) {
  return PDFDocument.load(await doc.save());
}

function imageNameOn(page) {
  const xobjects = page.node.Resources().lookup(PDFName.of('XObject'));
  return xobjects.keys()[0].asString().slice(1);
}

function boxOf(rect) {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

async function checkOutput(pdfBytes, expectedBox, expectedRotation = 0) {
  const out = await PDFDocument.load(pdfBytes);
  assert.equal(out.getPageCount(), 1);
  const page = out.getPage(0);
  assert.deepEqual(boxOf(page.getMediaBox()), expectedBox);
  assert.deepEqual(boxOf(page.getCropBox()), expectedBox);
  assert.equal(page.getRotation().angle, expectedRotation);
}

test('trims a Vinted-style page to the 4x6 label', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage(LETTER_LANDSCAPE);
  page.drawImage(await doc.embedPng(makePng(12, 18)), VINTED_BOX);

  const { pdfBytes, labels } = await cropLabelPdf(await doc.save());
  assert.deepEqual(labels[0], { ...VINTED_BOX, widthIn: 4, heightIn: 6 });
  await checkOutput(pdfBytes, VINTED_BOX, 0);
});

test('turns a sideways label upright', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage(LETTER_LANDSCAPE);
  const box = { x: 300, y: 100, width: 432, height: 288 };
  page.drawImage(await doc.embedPng(makePng(18, 12)), box);

  const { pdfBytes } = await cropLabelPdf(await doc.save());
  await checkOutput(pdfBytes, box, 90);
});

test('handles a label image drawn with a rotation', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage(LETTER_LANDSCAPE);
  // Rotating 90° about (500, 50) puts the 288x432 image at x 68..500, y 50..338.
  page.drawImage(await doc.embedPng(makePng(12, 18)), { x: 500, y: 50, width: 288, height: 432, rotate: degrees(90) });

  const { pdfBytes } = await cropLabelPdf(await doc.save());
  await checkOutput(pdfBytes, { x: 68, y: 50, width: 432, height: 288 }, 90);
});

test('picks the label over a small logo', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage(LETTER_LANDSCAPE);
  const img = await doc.embedPng(makePng(12, 18));
  page.drawImage(img, { x: 600, y: 500, width: 50, height: 50 });
  page.drawImage(img, VINTED_BOX);

  const { pdfBytes } = await cropLabelPdf(await doc.save());
  await checkOutput(pdfBytes, VINTED_BOX);
});

test('finds a label nested inside a form XObject', async () => {
  const inner = await PDFDocument.create();
  const innerPage = inner.addPage([288, 432]);
  innerPage.drawImage(await inner.embedPng(makePng(12, 18)), { x: 0, y: 0, width: 288, height: 432 });
  const innerLoaded = await reload(inner);

  const doc = await PDFDocument.create();
  const page = doc.addPage(LETTER_LANDSCAPE);
  const [embedded] = await doc.embedPdf(await innerLoaded.save());
  page.drawPage(embedded, { x: 100, y: 80 });

  const { pdfBytes } = await cropLabelPdf(await doc.save());
  await checkOutput(pdfBytes, { x: 100, y: 80, width: 288, height: 432 });
});

test('drops pages that have no label', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage(LETTER_LANDSCAPE).drawText('Packing instructions', { x: 50, y: 500, font });
  doc.addPage(LETTER_LANDSCAPE).drawImage(await doc.embedPng(makePng(12, 18)), VINTED_BOX);

  const { pdfBytes } = await cropLabelPdf(await doc.save());
  await checkOutput(pdfBytes, VINTED_BOX);
});

test('throws LabelNotFoundError when there is no label image', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage(LETTER_LANDSCAPE).drawText('Not a label', { x: 50, y: 500, font });

  await assert.rejects(cropLabelPdf(await doc.save()), LabelNotFoundError);
});

test('throws NotAPdfError for a web page or other non-PDF file', async () => {
  const html = new TextEncoder().encode('<!doctype html><title>Login</title><p>Please sign in</p>');
  await assert.rejects(cropLabelPdf(html), NotAPdfError);
});

test('accepts a PDF with a few junk bytes before the header', async () => {
  const doc = await PDFDocument.create();
  doc.addPage(LETTER_LANDSCAPE).drawImage(await doc.embedPng(makePng(12, 18)), VINTED_BOX);
  const bytes = Buffer.concat([Buffer.from('\r\n  '), Buffer.from(await doc.save())]);

  const { pdfBytes } = await cropLabelPdf(bytes);
  await checkOutput(pdfBytes, VINTED_BOX);
});

test('ignores q/Q/cm that appear inside comments, strings and inline image data', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage(LETTER_LANDSCAPE);
  page.drawImage(await doc.embedPng(makePng(12, 18)), { x: 0, y: 0, width: 10, height: 10 });
  const name = imageNameOn(page);

  const content = [
    '% Q 0 0 0 0 0 0 cm',
    'q 288 0 0 432 36 90 cm',
    'BT (fake Q 0 0 0 0 0 0 cm \\) still (nested) Q) Tj ET',
    '<51> Tj',
    'BI /W 4 /H 1 /CS /G /BPC 8 ID',
    ' Q 0 0 0 0 0 0 cm EI',
    `/${name} Do Q`,
  ].join('\n');
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(content)));

  const { pdfBytes } = await cropLabelPdf(await doc.save());
  await checkOutput(pdfBytes, VINTED_BOX);
});

test('reads page content split across several streams', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage(LETTER_LANDSCAPE);
  page.drawImage(await doc.embedPng(makePng(12, 18)), { x: 0, y: 0, width: 10, height: 10 });
  const name = imageNameOn(page);

  const parts = ['q 288 0 0 432 36', `90 cm /${name}`, 'Do Q'];
  const refs = parts.map((p) => doc.context.register(doc.context.stream(p)));
  page.node.set(PDFName.of('Contents'), doc.context.obj(refs));

  const { pdfBytes } = await cropLabelPdf(await doc.save());
  await checkOutput(pdfBytes, VINTED_BOX);
});

test('real Vinted label (set LABEL_SAMPLE to run)', { skip: !process.env.LABEL_SAMPLE }, async () => {
  const { pdfBytes, labels } = await cropLabelPdf(fs.readFileSync(process.env.LABEL_SAMPLE));
  assert.equal(labels.length, 1);
  assert.equal(labels[0].widthIn, 4);
  assert.equal(labels[0].heightIn, 6);
  await checkOutput(pdfBytes, { x: labels[0].x, y: labels[0].y, width: 288, height: 432 });
  if (process.env.LABEL_OUT) fs.writeFileSync(process.env.LABEL_OUT, pdfBytes);
});
