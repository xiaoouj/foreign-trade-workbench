/* Ali Chat Reader - isolated content script */
(function () {
  'use strict';

  var pageContext = {};

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    var data = event.data;
    if (!data || data.source !== 'ali-cs-helper' || data.type !== 'page-context') return;
    if (data.payload && typeof data.payload === 'object') pageContext = data.payload;
  });

  function requestPageContext() {
    try {
      window.postMessage({ source: 'ali-cs-helper', type: 'request-page-context' }, '*');
    } catch (e) {}
  }

  function read() {
    if (!window.AliChatReader) return { ok: false, error: 'reader-not-loaded', href: location.href };
    requestPageContext();
    return window.AliChatReader.readPage({ pageContext: pageContext });
  }

  function diagnose() {
    if (!window.AliChatReader) return { ok: false, error: 'reader-not-loaded', href: location.href };
    return window.AliChatReader.diagnose();
  }

  var listeners = {
    ALI_CS_PING: function () { return { ok: true, href: location.href, readerVersion: window.AliChatReader ? window.AliChatReader.version : '' }; },
    ALI_CS_READ: read,
    ALI_CS_DIAGNOSE: diagnose
  };

  try {
    chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
      if (!message || !message.type || !listeners[message.type]) return false;
      try {
        sendResponse(listeners[message.type](message));
      } catch (error) {
        sendResponse({ ok: false, error: String(error && error.message ? error.message : error), href: location.href });
      }
      return false;
    });
  } catch (e) {}

  // 页面首屏可能较慢，定期向页面上下文要一次账号信息（仅当前登录账号自己的显示名/memberId）
  requestPageContext();
  setTimeout(requestPageContext, 1500);
})();
