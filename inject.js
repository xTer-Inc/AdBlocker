(function () {
  'use strict';

  let isExtensionDisabledForSite = false;

  // Lắng nghe trạng thái bật/tắt từ bridge.js
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data && event.data.source === 'CC_ADGUARD_ISOLATED' && event.data.type === 'EXTENSION_STATE') {
      isExtensionDisabledForSite = Boolean(event.data.disabled);
    }
  });

  const currentHostname = window.location.hostname.toLowerCase();
  const SESSION_KEY = 'cc_guard_allow_' + currentHostname;

  // Các trang web ứng dụng / mạng xã hội cần cho phép mở popup/cửa sổ con (VD: gọi video Facebook/Messenger)
  const TRUSTED_APP_HOSTS = [
    'facebook.com',
    'messenger.com',
    'google.com',
    'meet.google.com',
    'accounts.google.com',
    'github.com',
    'microsoft.com',
    'live.com',
    'zalo.me',
    'discord.com',
    'telegram.org'
  ];

  function isTrustedAppContext() {
    return TRUSTED_APP_HOSTS.some(
      (d) => currentHostname === d || currentHostname.endsWith('.' + d)
    );
  }

  // Các domain đích an toàn không bị coi là quảng cáo ngoài ý muốn
  const SAFE_DOMAINS = [
    currentHostname,
    'facebook.com',
    'messenger.com',
    'fbcdn.net',
    'fbsbx.com',
    'google.com',
    'youtube.com',
    'youtu.be',
    'googlevideo.com',
    'github.com',
    'microsoft.com',
    'live.com',
    'apple.com',
    'discord.gg',
    'discord.com',
    't.me',
    'telegram.org',
    'zalo.me',
    'wikipedia.org',
    'reddit.com',
    'x.com',
    'twitter.com'
  ];

  const AD_PATTERNS = [
    'mplmncb', 'go88', 'sunwin', 'xoilac', 'mm88', 'xx88', 'mb66',
    'gk88', '789club', '789-club', 'fun88', 'kubet', 'bet', 'casino',
    'popunder', 'popup', 'redirect', 'aff', 'truyentv.link',
    'doubleclick', 'googlesyndication', 'adnxs', 'taboola', 'outbrain',
    'mgid', 'exoclick', 'propellerads', 'popads', 'adsterra'
  ];

  const originalWindowOpen = window.open;
  const originalAnchorClick = HTMLAnchorElement.prototype.click;

  function reportBlockedToPopup(url, blockType) {
    if (isExtensionDisabledForSite) return;
    window.postMessage(
      {
        source: 'CC_ADGUARD_MAIN',
        type: 'BLOCKED_EVENT',
        blockedUrl: url || 'about:blank (Popunder ẩn)',
        blockType: blockType
      },
      '*'
    );
  }

  function isSafeUrl(urlStr) {
    try {
      const parsed = new URL(urlStr, window.location.origin);
      if (
        parsed.protocol === 'javascript:' ||
        parsed.protocol === 'mailto:' ||
        parsed.protocol === 'tel:' ||
        parsed.protocol === 'blob:'
      ) {
        return true;
      }
      const host = parsed.hostname.toLowerCase();
      const currentBase = currentHostname.replace(/^www\./, '');
      if (host === currentBase || host.endsWith('.' + currentBase)) {
        return true;
      }
      return SAFE_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
    } catch (e) {
      return true;
    }
  }

  function isSuspiciousOrAd(urlStr) {
    if (!urlStr) return false;
    if (isSafeUrl(urlStr)) return false;

    const lower = urlStr.toLowerCase();
    return AD_PATTERNS.some((kw) => lower.includes(kw));
  }

  function isSessionAllowed() {
    return sessionStorage.getItem(SESSION_KEY) === 'true';
  }

  let toastTimeout = null;
  function showCocCocToast(targetUrl, onAllowCallback) {
    if (isSessionAllowed()) {
      onAllowCallback();
      return;
    }

    const oldToast = document.getElementById('cc-adguard-toast');
    if (oldToast) oldToast.remove();
    if (toastTimeout) clearTimeout(toastTimeout);

    const toast = document.createElement('div');
    toast.id = 'cc-adguard-toast';
    toast.innerHTML = `
      <div class="cc-toast-header">
        <span>🛡️ Đã chặn bật lên quảng cáo</span>
      </div>
      <div class="cc-toast-url" title="${targetUrl}">${targetUrl}</div>
      <div class="cc-toast-actions">
        <button type="button" class="cc-btn cc-btn-block" id="cc-guard-deny">Chặn (8s)</button>
        <button type="button" class="cc-btn cc-btn-allow" id="cc-guard-allow">Cho phép trên trang này</button>
      </div>
    `;

    (document.body || document.documentElement).appendChild(toast);

    const denyBtn = toast.querySelector('#cc-guard-deny');
    const allowBtn = toast.querySelector('#cc-guard-allow');

    let secondsLeft = 8;
    const countdownInterval = setInterval(() => {
      secondsLeft--;
      if (denyBtn && secondsLeft > 0) {
        denyBtn.textContent = `Chặn (${secondsLeft}s)`;
      }
    }, 1000);

    function closeToast() {
      clearInterval(countdownInterval);
      clearTimeout(toastTimeout);
      if (toast.parentNode) toast.remove();
    }

    toastTimeout = setTimeout(closeToast, 8000);

    denyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeToast();
    });

    allowBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sessionStorage.setItem(SESSION_KEY, 'true');
      closeToast();
      onAllowCallback();
    });
  }

  // =========================================================================
  // PHẦN 1: CHẶN QUẢNG CÁO YOUTUBE CHUẨN CỐC CỐC (KHÔNG XUẤT HIỆN QUẢNG CÁO)
  // =========================================================================
  if (currentHostname.includes('youtube.com')) {
    // 1.1. Lọc sạch dữ liệu quảng cáo trong JSON cấu hình player của YouTube (ytInitialPlayerResponse)
    function stripYouTubeAdsFromObject(obj) {
      if (!obj || typeof obj !== 'object') return obj;
      const adKeys = [
        'adPlacements',
        'adSlots',
        'playerAds',
        'adBreakHeartbeatParams',
        'auxiliaryUi'
      ];
      for (const key of adKeys) {
        if (key in obj) {
          delete obj[key];
        }
      }
      return obj;
    }

    // Chặn biến khởi tạo ytInitialPlayerResponse
    let _ytInitialPlayerResponse = window.ytInitialPlayerResponse;
    try {
      Object.defineProperty(window, 'ytInitialPlayerResponse', {
        configurable: true,
        get() {
          return _ytInitialPlayerResponse;
        },
        set(val) {
          if (!isExtensionDisabledForSite) {
            _ytInitialPlayerResponse = stripYouTubeAdsFromObject(val);
          } else {
            _ytInitialPlayerResponse = val;
          }
        }
      });
    } catch (e) {}

    // Chặn API fetch nội bộ của YouTube (/youtubei/v1/player) để xóa adPlacements trước khi phát video
    const origFetch = window.fetch;
    window.fetch = async function (...args) {
      const response = await origFetch.apply(this, args);
      if (isExtensionDisabledForSite) return response;

      try {
        const reqUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
        if (reqUrl.includes('/youtubei/v1/player')) {
          const clone = response.clone();
          const data = await clone.json();
          if (data && (data.adPlacements || data.adSlots || data.playerAds)) {
            stripYouTubeAdsFromObject(data);
            reportBlockedToPopup('youtubei/v1/player (Ad Slot)', 'Quảng cáo YouTube');
            return new Response(JSON.stringify(data), {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers
            });
          }
        }
      } catch (e) {}
      return response;
    };

    // 1.2. Vòng lặp kiểm tra & tua qua ngay lập tức nếu có luồng quảng cáo lọt vào trình phát
    let lastLoggedYtAdTime = 0;
    setInterval(() => {
      if (isExtensionDisabledForSite) return;

      const player = document.querySelector('#movie_player');
      const video = document.querySelector('video.html5-main-video');

      if (player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))) {
        if (video && isFinite(video.duration) && video.duration > 0) {
          video.muted = true;
          video.currentTime = video.duration;
        }

        const skipBtn = document.querySelector(
          '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button'
        );
        if (skipBtn) {
          skipBtn.click();
        }

        const now = Date.now();
        if (now - lastLoggedYtAdTime > 3000) {
          lastLoggedYtAdTime = now;
          reportBlockedToPopup('youtube.com (Video Ad)', 'Quảng cáo YouTube');
        }
      }

      // Đóng banner quảng cáo overlay đè lên video
      const overlayCloseBtn = document.querySelector('.ytp-ad-overlay-close-button');
      if (overlayCloseBtn) {
        overlayCloseBtn.click();
      }
    }, 150);
  }

  // =========================================================================
  // PHẦN 2: CHẶN POPUNDER & CHUYỂN HƯỚNG NGẦM (BỎ QUA FACEBOOK/MESSENGER CALL)
  // =========================================================================
  try {
    Object.defineProperty(window, 'urlPopup', {
      get: () => '',
      set: () => {},
      configurable: false
    });
  } catch (e) {}

  window.open = function (url, target, features) {
    // Nếu người dùng đã tắt extension trên web này hoặc đang ở ứng dụng tin cậy (Facebook/Messenger Call)
    if (isExtensionDisabledForSite || isTrustedAppContext()) {
      return originalWindowOpen.apply(this, arguments);
    }

    if (!url || url === 'about:blank') {
      reportBlockedToPopup('about:blank', 'Popunder ẩn');
      return null;
    }

    if (!isSafeUrl(url)) {
      if (isSessionAllowed()) {
        return originalWindowOpen.apply(this, arguments);
      }
      reportBlockedToPopup(url, 'Popup / Tab mới');
      showCocCocToast(url, () => {
        originalWindowOpen.call(window, url, '_blank', 'noopener');
      });
      return null;
    }

    return originalWindowOpen.apply(this, arguments);
  };

  HTMLAnchorElement.prototype.click = function () {
    if (isExtensionDisabledForSite || isTrustedAppContext()) {
      return originalAnchorClick.apply(this, arguments);
    }

    const href = this.getAttribute('href') || this.href;
    if (href && !isSafeUrl(href)) {
      if (isSessionAllowed()) {
        return originalAnchorClick.apply(this, arguments);
      }
      reportBlockedToPopup(href, 'Chuyển hướng ngầm');
      showCocCocToast(href, () => {
        originalWindowOpen.call(window, href, '_blank', 'noopener');
      });
      return;
    }
    return originalAnchorClick.apply(this, arguments);
  };

  document.addEventListener(
    'click',
    function (e) {
      if (isExtensionDisabledForSite || isTrustedAppContext()) return;
      if (e.target.closest('#cc-adguard-toast')) return;

      const anchor = e.target.closest('a');
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;

      if (isSuspiciousOrAd(href)) {
        if (isSessionAllowed()) return;

        e.preventDefault();
        e.stopImmediatePropagation();

        reportBlockedToPopup(anchor.href, 'Liên kết quảng cáo');
        showCocCocToast(anchor.href, () => {
          if (anchor.target === '_blank') {
            originalWindowOpen.call(window, anchor.href, '_blank', 'noopener');
          } else {
            window.location.href = anchor.href;
          }
        });
      }
    },
    true
  );
})();