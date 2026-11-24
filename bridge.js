(function () {
  'use strict';

  const currentHost = window.location.hostname.replace(/^www\./, '');

  // Kiểm tra xem trang web hiện tại có đang bị người dùng tắt extension hay không
  chrome.storage.local.get({ disabledDomains: [] }, (data) => {
    const isDisabled = (data.disabledDomains || []).includes(currentHost);

    // Gửi trạng thái sang MAIN world (inject.js)
    window.postMessage(
      {
        source: 'CC_ADGUARD_ISOLATED',
        type: 'EXTENSION_STATE',
        disabled: isDisabled
      },
      '*'
    );

    // Nếu tắt trên trang này -> gỡ bỏ class kích hoạt CSS chặn quảng cáo
    if (isDisabled) {
      document.documentElement.classList.add('xter-adguard-disabled');
    }
  });

  // Lắng nghe thay đổi trạng thái bật/tắt theo thời gian thực
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.disabledDomains) {
      const isDisabled = (changes.disabledDomains.newValue || []).includes(currentHost);
      window.postMessage(
        {
          source: 'CC_ADGUARD_ISOLATED',
          type: 'EXTENSION_STATE',
          disabled: isDisabled
        },
        '*'
      );
      if (isDisabled) {
        document.documentElement.classList.add('xter-adguard-disabled');
      } else {
        document.documentElement.classList.remove('xter-adguard-disabled');
      }
    }
  });

  // Lắng nghe sự kiện chặn từ MAIN world và chuyển tiếp về background.js
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