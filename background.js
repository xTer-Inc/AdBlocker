const ALLOW_RULE_BASE_ID = 10000;

// Đồng bộ quy tắc ngoại lệ tầng mạng cho các domain người dùng đã tắt extension
async function syncDomainAllowRules(disabledDomains) {
  try {
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existingRules
      .filter(r => r.id >= ALLOW_RULE_BASE_ID)
      .map(r => r.id);

    const addRules = disabledDomains.map((domain, index) => ({
      id: ALLOW_RULE_BASE_ID + index,
      priority: 100,
      action: { type: 'allowAllRequests' },
      condition: {
        initiatorDomains: [domain],
        resourceTypes: ['main_frame', 'sub_frame', 'script', 'xmlhttprequest', 'image', 'media', 'other']
      }
    }));

    // Bổ sung allow rule cho các request phát sinh từ domain bị tắt
    const addRequestRules = disabledDomains.map((domain, index) => ({
      id: ALLOW_RULE_BASE_ID + 5000 + index,
      priority: 100,
      action: { type: 'allow' },
      condition: {
        initiatorDomains: [domain]
      }
    }));

    const allRemoveIds = existingRules.map(r => r.id);
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: allRemoveIds,
      addRules: [...addRules, ...addRequestRules]
    });
  } catch (e) {
    console.error('[AdBlocker] Lỗi đồng bộ dynamic rules:', e);
  }
}

// Khởi tạo đồng bộ khi extension khởi động hoặc cài đặt
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get({ disabledDomains: [] }, (data) => {
    syncDomainAllowRules(data.disabledDomains);
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get({ disabledDomains: [] }, (data) => {
    syncDomainAllowRules(data.disabledDomains);
  });
});

// Lắng nghe thay đổi danh sách tắt web từ popup
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.disabledDomains) {
    syncDomainAllowRules(changes.disabledDomains.newValue || []);
  }
});

// Lắng nghe các request bị chặn bởi rules.json (tầng mạng)
if (chrome.declarativeNetRequest && chrome.declarativeNetRequest.onRuleMatchedDebug) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
    const tabId = info.request.tabId;
    if (tabId < 0) return;

    let sourceHost = 'Trang hiện tại';
    try {
      if (info.request.initiator) {
        sourceHost = new URL(info.request.initiator).hostname;
      }
    } catch (e) {}

    saveBlockedItem({
      tabId: tabId,
      sourceHost: sourceHost,
      blockedUrl: info.request.url,
      type: sourceHost.includes('youtube.com') ? 'Quảng cáo YouTube' : 'Script/Banner (Mạng)',
      timestamp: Date.now()
    });
  });
}

// Lắng nghe dữ liệu chặn popunder/click/youtube gửi từ bridge.js
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'LOG_BLOCKED_AD' && sender.tab) {
    saveBlockedItem({
      tabId: sender.tab.id,
      sourceHost: msg.sourceHost || 'Trang hiện tại',
      blockedUrl: msg.blockedUrl,
      type: msg.blockType || 'Popunder/Redirect',
      timestamp: Date.now()
    });
  }
});

function saveBlockedItem(entry) {
  chrome.storage.local.get({ blockedLogs: [], disabledDomains: [] }, (data) => {
    // Nếu domain hiện tại đang bị người dùng tắt -> không ghi nhận
    const cleanHost = (entry.sourceHost || '').replace(/^www\./, '');
    if (data.disabledDomains.includes(cleanHost)) return;

    const logs = data.blockedLogs;
    logs.unshift(entry);

    if (logs.length > 200) {
      logs.length = 200;
    }

    chrome.storage.local.set({ blockedLogs: logs }, () => {
      updateBadgeForTab(entry.tabId, logs, data.disabledDomains, cleanHost);
    });
  });
}

function updateBadgeForTab(tabId, logs, disabledDomains = [], currentHost = '') {
  if (currentHost && disabledDomains.includes(currentHost)) {
    chrome.action.setBadgeText({ tabId: tabId, text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: '#64748b' });
    return;
  }

  const count = logs.filter(item => item.tabId === tabId).length;
  chrome.action.setBadgeText({
    tabId: tabId,
    text: count > 0 ? String(count) : ''
  });
  chrome.action.setBadgeBackgroundColor({
    tabId: tabId,
    color: '#16a34a'
  });
}

// Cập nhật lại badge khi chuyển tab
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    let host = '';
    try {
      if (tab && tab.url) host = new URL(tab.url).hostname.replace(/^www\./, '');
    } catch (e) {}

    chrome.storage.local.get({ blockedLogs: [], disabledDomains: [] }, (data) => {
      updateBadgeForTab(activeInfo.tabId, data.blockedLogs, data.disabledDomains, host);
    });
  });
});