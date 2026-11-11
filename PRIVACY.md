---
permalink: /privacy/
title: Label Snip privacy policy
---

# Label Snip privacy policy

_Last updated: November 11, 2026_

Label Snip is a Chrome extension that trims a shipping label PDF down to a print-ready 4×6 page. This policy explains what it touches and what it does with it.

## The short version

Label Snip works entirely inside your browser. It has no server, no account, no analytics and no ads. It never sends, sells or shares anything about you or your buyers.

## What Label Snip reads, and why

Label Snip only does anything when you click its toolbar icon. Then it reads:

- **The address of the tab you clicked.** It uses this to download that one PDF. It doesn't keep the address or look at any other tab.
- **The label PDF itself.** Shipping labels contain names and mailing addresses (yours and your buyer's). Label Snip reads the PDF to find the label, trims the page to it, and shows you the result in a new tab.

When it downloads the PDF, Chrome sends your existing cookies for that site along with the request, the same as if you opened the link yourself. That's what lets labels work on sites where you're signed in. Label Snip can't read those cookies.

## What happens to that data

- Everything is processed on your computer, in your browser.
- The trimmed PDF exists only in the tab Label Snip opens, until you close it or save it yourself.
- Nothing is uploaded, logged or sent to the developer or anyone else.
- Label Snip doesn't store any of your data. The only thing kept is Chrome's own list of sites you've allowed Label Snip to read. You can review or remove that list at any time: `chrome://extensions` → Label Snip → **Details** → **Site access**.

## Permissions

- **activeTab:** lets Label Snip see the address of the tab you clicked, only at the moment you click.
- **Access to Vinted's label host** (`svc-shipping-labels.s3.eu-central-1.amazonaws.com`): so Vinted labels work without an extra prompt.
- **Optional access to other https sites:** requested one site at a time, only after you click **Allow**, so labels from other sites can be downloaded.

## Use of data

Label Snip's use of information follows the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/), including the Limited Use requirements. Data is used only to trim the label you asked it to trim.

## Changes

If this policy changes, the new version will be posted here with a new date.

## Contact

Questions or concerns: open an issue at <https://github.com/cmjdev-25/label-snip/issues>.
