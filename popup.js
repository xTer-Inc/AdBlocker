document.addEventListener('DOMContentLoaded', () => {
  const currentHostEl = document.getElementById('currentHost');
  const siteStatusTextEl = document.getElementById('siteStatusText');
  const siteToggleSwitch = document.getElementById('siteToggleSwitch');
  const tabBlockedCountEl = document.getElementById('tabBlockedCount');
  const totalBlockedCountEl = document.getElementById('totalBlockedCount');
  const toggleDetailsBtn = document.getElementById('toggleDetailsBtn');
  const clearLogsBtn = document.getElementById('clearLogsBtn');
  const detailsWrapper = document.getElementById('detailsWrapper');
  const blockedListEl = document.getElementById('blockedList');
  const filterBtns = document.querySelectorAll('.tab-btn');
  const githubBtn = document.getElementById('githubBtn');

  let activeTabId = null;
  let cleanHostname = '';
  let allLogs = [];
  let currentFilter = 'tab';
  let isExpanded = false;

  // Mở trang GitHub trong tab mới
  if (githubBtn) {
    githubBtn.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'https://github.com/xTer-Inc' });
    });
  }

  function updateSwitchUI(isEnabled) {
    siteToggleSwitch.checked = isEnabled;
    if (isEnabled) {
      siteStatusTextEl.textContent = 'Đang bật bảo vệ trên trang này';
      siteStatusTextEl.classList.remove('off');
    } else {
      siteStatusTextEl.textContent = 'Đã tạm tắt trên trang này';
      siteStatusTextEl.classList.add('off');
    }
  }

  // Lấy thông tin tab đang mở
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    if (activeTab) {
      activeTabId = activeTab.id;
      try {
        const url = new URL(activeTab.url);
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          cleanHostname = url.hostname.replace(/^www\./, '');
          currentHostEl.textContent = cleanHostname;
        } else {
          currentHostEl.textContent = 'Trang hệ thống trình duyệt';
          siteToggleSwitch.disabled = true;
          siteStatusTextEl.textContent = 'Không áp dụng trên trang hệ thống';
        }
      } catch (e) {
        currentHostEl.textContent = 'Trang hệ thống';
        siteToggleSwitch.disabled = true;
      }
    }

    chrome.storage.local.get({ blockedLogs: [], disabledDomains: [] }, (data) => {
      allLogs = data.blockedLogs || [];
      const disabledDomains = data.disabledDomains || [];

      if (cleanHostname) {
        const isEnabled = !disabledDomains.includes(cleanHostname);
        updateSwitchUI(isEnabled);
      }

      const tabLogs = allLogs.filter(item => item.tabId === activeTabId);
      tabBlockedCountEl.textContent = tabLogs.length;
      totalBlockedCountEl.textContent = allLogs.length;

      if (isExpanded) {
        renderList();
      }
    });
  });

  // Sự kiện gạt Bật/Tắt cho trang web hiện tại
  siteToggleSwitch.addEventListener('change', () => {
    if (!cleanHostname) return;
    const isEnabled = siteToggleSwitch.checked;

    chrome.storage.local.get({ disabledDomains: [] }, (data) => {
      let disabledDomains = data.disabledDomains || [];

      if (isEnabled) {
        disabledDomains = disabledDomains.filter(d => d !== cleanHostname);
      } else {
        if (!disabledDomains.includes(cleanHostname)) {
          disabledDomains.push(cleanHostname);
        }
      }

      chrome.storage.local.set({ disabledDomains }, () => {
        updateSwitchUI(isEnabled);
        if (activeTabId) {
          chrome.action.setBadgeText({
            tabId: activeTabId,
            text: isEnabled ? '' : 'OFF'
          });
          chrome.action.setBadgeBackgroundColor({
            tabId: activeTabId,
            color: isEnabled ? '#16a34a' : '#64748b'
          });
          // Tải lại tab hiện tại để áp dụng thay đổi ngay lập tức
          chrome.tabs.reload(activeTabId);
        }
      });
    });
  });

  function formatTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function renderList() {
    const items = currentFilter === 'tab'
      ? allLogs.filter(item => item.tabId === activeTabId)
      : allLogs;

    if (items.length === 0) {
      blockedListEl.innerHTML = `<div class="empty-msg">Chưa có quảng cáo nào bị chặn trong mục này.</div>`;
      return;
    }

    blockedListEl.innerHTML = items.map(item => `
      <div class="log-item">
        <div class="log-top">
          <span class="log-badge">${escapeHtml(item.type)}</span>
          <span class="log-time">${formatTime(item.timestamp)}</span>
        </div>
        <div class="log-url">${escapeHtml(item.blockedUrl)}</div>
        <div class="log-source">Nguồn: ${escapeHtml(item.sourceHost)}</div>
      </div>
    `).join('');
  }

  toggleDetailsBtn.addEventListener('click', () => {
    isExpanded = !isExpanded;
    if (isExpanded) {
      detailsWrapper.classList.add('open');
      toggleDetailsBtn.textContent = '▲ Thu gọn danh sách';
      renderList();
    } else {
      detailsWrapper.classList.remove('open');
      toggleDetailsBtn.textContent = '▼ Xem danh sách đã chặn';
    }
  });

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderList();
    });
  });

  clearLogsBtn.addEventListener('click', () => {
    chrome.storage.local.set({ blockedLogs: [] }, () => {
      allLogs = [];
      tabBlockedCountEl.textContent = '0';
      totalBlockedCountEl.textContent = '0';
      if (activeTabId && siteToggleSwitch.checked) {
        chrome.action.setBadgeText({ tabId: activeTabId, text: '' });
      }
      renderList();
    });
  });
});