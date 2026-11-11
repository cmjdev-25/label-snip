// Downloads the label PDF from the clicked tab, trims it to 4x6, then shows
// the result in Chrome's PDF viewer. The first time a site is used, it asks
// for the site's OK (Chrome remembers it).

class FriendlyError extends Error {
  constructor(title, detail) {
    super(title);
    this.detail = detail;
  }
}

const OPEN_LABEL_HINT = 'Open the shipping label PDF, then click the Label Snip icon while that tab is showing.';

function render(title, { detail, technical, isError = false, button } = {}) {
  const main = document.getElementById('status');
  main.replaceChildren();
  const h1 = document.createElement('h1');
  if (isError) h1.className = 'error';
  h1.textContent = title;
  main.append(h1);
  for (const text of [detail, technical]) {
    if (!text) continue;
    const p = document.createElement('p');
    if (text === technical) {
      const code = document.createElement('code');
      code.textContent = text;
      p.append(code);
    } else {
      p.textContent = text;
    }
    main.append(p);
  }
  if (button) {
    const btn = document.createElement('button');
    btn.textContent = button.label;
    btn.addEventListener('click', button.onClick, { once: true });
    main.append(btn);
    btn.focus();
  }
  document.title = 'Label Snip: ' + title;
}

function readSource() {
  const src = new URLSearchParams(location.search).get('src') || '';
  let url;
  try {
    url = new URL(src);
  } catch {
    throw new FriendlyError("This tab isn't a label PDF.", OPEN_LABEL_HINT);
  }
  if (url.protocol === 'blob:') {
    throw new FriendlyError(
      "Label Snip can't read this tab.",
      'This site built the PDF inside the browser, so there is no web link to download it from.'
    );
  }
  if (url.protocol === 'http:') {
    throw new FriendlyError(
      "Label Snip only reads secure (https) pages.",
      "This tab's address starts with http://, so Label Snip won't download from it."
    );
  }
  if (url.protocol !== 'https:') {
    throw new FriendlyError("This tab isn't a label PDF.", OPEN_LABEL_HINT);
  }
  return url;
}

// Chrome only lets us read a site after you OK it once. The OK has to come
// from a click, hence the button.
async function ensureSiteAccess(url) {
  const origins = [`${url.protocol}//${url.hostname}/*`];
  if (await chrome.permissions.contains({ origins })) return;

  await new Promise((resolve, reject) => {
    render(`Allow Label Snip to read labels from ${url.hostname}?`, {
      detail: 'You only need to do this once per site. Label Snip only reads a site when you click its icon on that tab.',
      button: {
        label: 'Allow',
        onClick: async (event) => {
          event.currentTarget.disabled = true;
          let granted = false;
          try {
            granted = await chrome.permissions.request({ origins });
          } catch (err) {
            reject(err);
            return;
          }
          if (granted) {
            render('Snipping label…');
            resolve();
          } else {
            reject(new FriendlyError(
              `Label Snip can't read labels from ${url.hostname} without your OK.`,
              'Click the Label Snip icon again if you change your mind.'
            ));
          }
        },
      },
    });
  });
}

async function downloadLabel(url) {
  let res;
  try {
    // credentials: include sends your login cookies, for sites that only show the label when you're signed in.
    res = await fetch(url.href, { credentials: 'include', cache: 'no-store' });
  } catch {
    throw new FriendlyError("Couldn't download the label.", 'Check your internet connection and try again.');
  }
  if (res.status === 401 || res.status === 403) {
    throw new FriendlyError(
      `${url.hostname} wouldn't send the label.`,
      'The link may have expired, or you may have been signed out. Open the label again from the site, then click the Label Snip icon.'
    );
  }
  if (!res.ok) {
    throw new FriendlyError("Couldn't download the label.", `${url.hostname} answered with error ${res.status}. Try again in a minute.`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

async function run() {
  const url = readSource();
  await ensureSiteAccess(url);
  const bytes = await downloadLabel(url);

  let result;
  try {
    result = await LabelCrop.cropLabelPdf(bytes);
  } catch (err) {
    if (err instanceof LabelCrop.NotAPdfError) {
      throw new FriendlyError("This tab isn't showing a PDF.", OPEN_LABEL_HINT);
    }
    if (err instanceof LabelCrop.LabelNotFoundError) {
      throw new FriendlyError(
        "Couldn't find a label in this PDF.",
        'Label Snip works with labels that are a single picture on the page, like Vinted’s. This one is drawn differently.'
      );
    }
    throw err;
  }

  const blob = new Blob([result.pdfBytes], { type: 'application/pdf' });
  location.replace(URL.createObjectURL(blob));
}

run().catch((err) => {
  if (err instanceof FriendlyError) render(err.message, { detail: err.detail, isError: true });
  else render('Something went wrong reading this PDF.', {
    detail: 'Try opening the label again from the site.',
    technical: String((err && err.message) || err),
    isError: true,
  });
});
