/* Ali Chat Reader - background service worker */
chrome.runtime.onInstalled.addListener(function () {
  try {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(function () {});
  } catch (e) {}
});

chrome.runtime.onStartup.addListener(function () {
  try {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(function () {});
  } catch (e) {}
});

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message && message.type === 'ALI_CS_OPEN_SIDE_PANEL' && sender.tab) {
    try {
      chrome.sidePanel.open({ tabId: sender.tab.id }).then(function () { sendResponse({ ok: true }); }).catch(function (e) { sendResponse({ ok: false, error: String(e) }); });
      return true;
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  }
  return false;
});
