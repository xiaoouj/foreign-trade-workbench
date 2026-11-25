/* Ali Chat Reader - page world probe (only reads the signed-in seller's own account label) */
(function () {
  'use strict';

  function publish() {
    var user = null;
    try {
      user = window.GDATA && window.GDATA.user ? window.GDATA.user : null;
    } catch (e) {}
    var payload = {
      seller: user ? {
        memberId: String(user.memberId || ''),
        displayName: String(user.displayName || ''),
        userName: String(user.userName || ''),
        userRole: String(user.userRole || '')
      } : {}
    };
    try {
      window.postMessage({ source: 'ali-cs-helper', type: 'page-context', payload: payload }, '*');
    } catch (e) {}
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    var data = event.data;
    if (!data || data.source !== 'ali-cs-helper') return;
    if (data.type === 'request-page-context') publish();
  });

  publish();
  setTimeout(publish, 1200);
  setTimeout(publish, 3000);
})();
