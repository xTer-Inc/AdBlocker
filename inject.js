(function () {
  'use strict';

  const SESSION_KEY = 'cc_guard_allow_' + window.location.hostname;

  // Các domain phổ biến / uy tín không bị coi là quảng cáo ngoài ý muốn
  const SAFE_DOMAINS = [
    window.location.hostname,
    'google.com',
    'youtube.com',
    'facebook.com',
    'messenger.com',
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

  // Từ khóa nhận diện link quảng cáo / nhà cái / redirect trên mọi trang web
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
      // Cho phép cùng tên miền gốc (kể cả subdomain)
      const currentBase = window.location.hostname.replace(/^www\./, '');
      if (host === currentBase || host.endsWith('.' + currentBase)) {
        return true;
      }
      return SAFE_DOMAINS.some(d => host === d || host.endsWith('.' + d));
    } catch (e) {
      return true;
    }
  }

  function isSuspiciousOrAd(urlStr) {
    if (!urlStr) return false;
    if (isSafeUrl(urlStr)) return false;

    const lower = urlStr.toLowerCase();
    return AD_PATTERNS.some(kw => lower.includes(kw));
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

  // Vô hiệu hóa biến popup phổ biến
  try {
    Object.defineProperty(window, 'urlPopup', {
      get: () => '',
      set: () => {},
      configurable: false
    });
  } catch (e) {}

  // Chặn window.open (popunder ngầm hoặc bật tab quảng cáo ngoài ý muốn trên mọi web)
  window.open = function (url, target, features) {
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

  // Chặn script tự tạo thẻ <a> ảo và kích hoạt .click() ngầm
  HTMLAnchorElement.prototype.click = function () {
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

  // Bắt sự kiện click trực tiếp vào link quảng cáo trên trang
  document.addEventListener(
    'click',
    function (e) {
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