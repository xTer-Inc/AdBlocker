document.addEventListener('DOMContentLoaded', () => {
  const currentHostEl = document.getElementById('currentHost');
  const tabBlockedCountEl = document.getElementById('tabBlockedCount');
  const totalBlockedCountEl = document.getElementById('totalBlockedCount');
  const toggleDetailsBtn = document.getElementById('toggleDetailsBtn');
  const clearLogsBtn = document.getElementById('clearLogsBtn');
  const detailsWrapper = document.getElementById('detailsWrapper');
  const blockedListEl = document.getElementById('blockedList');
  const filterBtns = document.querySelectorAll('.tab-btn');
  const githubBtn = document.getElementById('githubBtn');

  let activeTabId = null;
  let allLogs = [];
  let currentFilter = 'tab';
  let isExpanded = false;

  // Đảm bảo mở trang GitHub trong tab mới khi click
  if (githubBtn) {
    githubBtn.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'https://github.com/xTer-Inc' });
    });
  }

  // Lấy thông tin tab đang mở
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    if (activeTab) {
      activeTabId = activeTab.id;
      try {
        const url = new URL(activeTab.url);
        currentHostEl.textContent = url.hostname || activeTab.url;
      } catch (e) {
        currentHostEl.textContent = 'Trang hệ thống';
      }
    }
    loadLogs();
  });

  function loadLogs() {
    chrome.storage.local.get({ blockedLogs: [] }, (data) => {
      allLogs = data.blockedLogs || [];
      const tabLogs = allLogs.filter(item => item.tabId === activeTabId);

      tabBlockedCountEl.textContent = tabLogs.length;
      totalBlockedCountEl.textContent = allLogs.length;

      if (isExpanded) {
        renderList();
      }
    });
  }

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

  // Bấm nút "Xem danh sách đã chặn" / "Thu gọn"
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

  // Chuyển tab lọc giữa "Tab hiện tại" và "Tất cả các trang"
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderList();
    });
  });

  // Xóa lịch sử đã chặn
  clearLogsBtn.addEventListener('click', () => {
    chrome.storage.local.set({ blockedLogs: [] }, () => {
      allLogs = [];
      tabBlockedCountEl.textContent = '0';
      totalBlockedCountEl.textContent = '0';
      if (activeTabId) {
        chrome.action.setBadgeText({ tabId: activeTabId, text: '' });
      }
      renderList();
    });
  });
});