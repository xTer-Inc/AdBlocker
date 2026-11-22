(function () {
  'use strict';

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data && event.data.source === 'CC_ADGUARD_MAIN' && event.data.type === 'BLOCKED_EVENT') {
      chrome.runtime.sendMessage({
        type: 'LOG_BLOCKED_AD',
        sourceHost: window.location.hostname,
        blockedUrl: event.data.blockedUrl,
        blockType: event.data.blockType
      });
    }
  });
})();