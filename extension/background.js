// Clicking the toolbar icon opens the crop page next to the current tab.
// activeTab lets us see the clicked tab's URL; the crop page decides whether
// it's something it can read and asks for the site's OK if needed.
function openCropTab(tab) {
  const src = tab.url || '';
  return chrome.tabs.create({
    url: chrome.runtime.getURL('crop.html') + (src ? '?src=' + encodeURIComponent(src) : ''),
    index: tab.index + 1,
    openerTabId: tab.id,
  });
}

chrome.action.onClicked.addListener(openCropTab);
