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

  // =========================================================================
  // PHẦN 1: HỆ THỐNG VƯỢT QUA QUÉT ADBLOCK (ANTI-ADBLOCK BYPASS ENGINE)
  // =========================================================================
  function initAntiAdBlockBypass() {
    if (isExtensionDisabledForSite) return;

    // 1.1. Giả lập thư viện quảng cáo đã tải thành công để đánh lừa script kiểm tra của web
    try {
      if (!window.adsbygoogle) {
        window.adsbygoogle = {
          loaded: true,
          push: function () {
            return 0;
          }
        };
      }
      const fakeFlags = ['canRunAds', 'isAdBlockActive', 'adblockEnabled', 'hasAdblock'];
      for (const flag of fakeFlags) {
        const expectedValue = flag === 'canRunAds';
        try {
          Object.defineProperty(window, flag, {
            get: () => expectedValue,
            set: () => {},
            configurable: true
          });
        } catch (e) {}
      }
    } catch (e) {}

    // 1.2. Đánh lừa kỹ thuật kiểm tra kích thước phần tử mồi nhử (Bait Element Detection)
    const baitClasses = ['adsbox', 'ad-banner', 'ad-placeholder', 'pub_300x250', 'text-ad'];
    function isBaitElement(el) {
      if (!el || !el.classList) return false;
      return baitClasses.some((cls) => el.classList.contains(cls));
    }

    const origOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    const origOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');

    if (origOffsetHeight && origOffsetHeight.get) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
        configurable: true,
        get: function () {
          if (!isExtensionDisabledForSite && isBaitElement(this)) {
            return 250;
          }
          return origOffsetHeight.get.call(this);
        }
      });
    }

    if (origOffsetWidth && origOffsetWidth.get) {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
        configurable: true,
        get: function () {
          if (!isExtensionDisabledForSite && isBaitElement(this)) {
            return 300;
          }
          return origOffsetWidth.get.call(this);
        }
      });
    }

    // 1.3. Giả lập phản hồi HTTP 200 OK cho các request thăm dò quảng cáo (tránh lỗi ERR_BLOCKED_BY_CLIENT)
    const probePatterns = [
      'pagead/js/adsbygoogle.js',
      'doubleclick.net/pagead',
      'googlesyndication.com/pagead',
      'youtube.com/pagead/',
      'youtube.com/api/stats/ads',
      'youtube.com/ptracking'
    ];

    const origFetch = window.fetch;
    window.fetch = async function (...args) {
      if (!isExtensionDisabledForSite) {
        const reqUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
        if (probePatterns.some((p) => reqUrl.includes(p))) {
          return new Response('', {
            status: 200,
            statusText: 'OK',
            headers: { 'Content-Type': 'application/javascript' }
          });
        }
      }
      return origFetch.apply(this, args);
    };

    const origXhrOpen = XMLHttpRequest.prototype.open;
    const origXhrSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this._xterReqUrl = typeof url === 'string' ? url : String(url || '');
      return origXhrOpen.apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      if (
        !isExtensionDisabledForSite &&
        this._xterReqUrl &&
        probePatterns.some((p) => this._xterReqUrl.includes(p))
      ) {
        Object.defineProperty(this, 'readyState', { value: 4 });
        Object.defineProperty(this, 'status', { value: 200 });
        Object.defineProperty(this, 'statusText', { value: 'OK' });
        Object.defineProperty(this, 'responseText', { value: '' });
        setTimeout(() => {
          if (typeof this.onreadystatechange === 'function') this.onreadystatechange();
          if (typeof this.onload === 'function') this.onload();
        }, 5);
        return;
      }
      return origXhrSend.apply(this, args);
    };
  }

  initAntiAdBlockBypass();

  // =========================================================================
  // PHẦN 2: CHẶN QUẢNG CÁO YOUTUBE & VÔ HIỆU HÓA CẢNH BÁO QUÉT ADBLOCK YOUTUBE
  // =========================================================================
  if (currentHostname.includes('youtube.com')) {
    function cleanYouTubePayload(obj) {
      if (!obj || typeof obj !== 'object') return obj;

      const blockedKeys = [
        'adPlacements',
        'adSlots',
        'playerAds',
        'adBreakHeartbeatParams',
        'enforcementMessageViewModel'
      ];

      for (const key of blockedKeys) {
        if (key in obj) {
          delete obj[key];
        }
      }

      // Loại bỏ hộp thoại cảnh báo AdBlock trong auxiliaryUi
      if (obj.auxiliaryUi && obj.auxiliaryUi.messageRenderers) {
        delete obj.auxiliaryUi.messageRenderers.bkaEnforcementMessageViewModel;
        delete obj.auxiliaryUi.messageRenderers.enforcementMessageViewModel;
      }

      return obj;
    }

    // Chặn biến khởi tạo ytInitialPlayerResponse và ytInitialData
    ['ytInitialPlayerResponse', 'ytInitialData'].forEach((propName) => {
      let _val = window[propName];
      try {
        Object.defineProperty(window, propName, {
          configurable: true,
          get() {
            return _val;
          },
          set(newVal) {
            _val = !isExtensionDisabledForSite ? cleanYouTubePayload(newVal) : newVal;
          }
        });
      } catch (e) {}
    });

    // Can thiệp JSON.parse để làm sạch mọi payload chứa quảng cáo hoặc cảnh báo AdBlock của YouTube
    const origJsonParse = JSON.parse;
    JSON.parse = function (...args) {
      const parsed = origJsonParse.apply(this, args);
      if (!isExtensionDisabledForSite && parsed && typeof parsed === 'object') {
        if (
          parsed.adPlacements ||
          parsed.adSlots ||
          parsed.playerAds ||
          parsed.auxiliaryUi?.messageRenderers?.bkaEnforcementMessageViewModel
        ) {
          cleanYouTubePayload(parsed);
        }
      }
      return parsed;
    };

    // Can thiệp API /youtubei/v1/player
    const prevFetch = window.fetch;
    window.fetch = async function (...args) {
      const response = await prevFetch.apply(this, args);
      if (isExtensionDisabledForSite) return response;

      try {
        const reqUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
        if (reqUrl.includes('/youtubei/v1/player') || reqUrl.includes('/youtubei/v1/next')) {
          const clone = response.clone();
          const data = await clone.json();
          if (
            data &&
            (data.adPlacements ||
              data.adSlots ||
              data.playerAds ||
              data.auxiliaryUi?.messageRenderers?.bkaEnforcementMessageViewModel)
          ) {
            cleanYouTubePayload(data);
            reportBlockedToPopup('youtubei/v1/player (Ad & Anti-AdBlock Bypass)', 'Quảng cáo YouTube');
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

    // Giám sát trình phát video & gỡ bỏ cảnh báo AdBlock nếu xuất hiện
    let lastLoggedYtAdTime = 0;
    let userPausedVideo = false;

    document.addEventListener(
      'click',
      (e) => {
        if (e.target.closest('.ytp-play-button, video.html5-main-video')) {
          const video = document.querySelector('video.html5-main-video');
          if (video && !video.paused) {
            userPausedVideo = true;
          } else {
            userPausedVideo = false;
          }
        }
      },
      true
    );

    setInterval(() => {
      if (isExtensionDisabledForSite) return;

      // 2.1. Xóa popup cảnh báo "Trình chặn quảng cáo vi phạm Điều khoản dịch vụ..."
      const enforcementModal = document.querySelector(
        'ytd-enforcement-message-view-model, tp-yt-paper-dialog:has(ytd-enforcement-message-view-model)'
      );
      if (enforcementModal) {
        enforcementModal.remove();
        document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach((b) => b.remove());
        document.body.style.overflow = 'auto';

        const video = document.querySelector('video.html5-main-video');
        if (video && video.paused && !userPausedVideo) {
          video.play().catch(() => {});
        }
        reportBlockedToPopup('YouTube Anti-AdBlock Popup', 'Bypass Cảnh báo YT');
      }

      // 2.2. Tua qua ngay lập tức nếu có luồng quảng cáo lọt vào trình phát
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

      const overlayCloseBtn = document.querySelector('.ytp-ad-overlay-close-button');
      if (overlayCloseBtn) {
        overlayCloseBtn.click();
      }
    }, 150);
  }

  // =========================================================================
  // PHẦN 3: CHẶN POPUNDER & CHUYỂN HƯỚNG NGẦM (BỎ QUA FACEBOOK/MESSENGER CALL)
  // =========================================================================
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

  try {
    Object.defineProperty(window, 'urlPopup', {
      get: () => '',
      set: () => {},
      configurable: false
    });
  } catch (e) {}

  window.open = function (url, target, features) {
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
