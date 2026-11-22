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
      type: 'Script/Banner (Mạng)',
      timestamp: Date.now()
    });
  });
}

// Lắng nghe dữ liệu chặn popunder/click gửi từ bridge.js
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
  chrome.storage.local.get({ blockedLogs: [] }, (data) => {
    const logs = data.blockedLogs;
    logs.unshift(entry);

    if (logs.length > 200) {
      logs.length = 200;
    }

    chrome.storage.local.set({ blockedLogs: logs }, () => {
      updateBadgeForTab(entry.tabId, logs);
    });
  });
}

function updateBadgeForTab(tabId, logs) {
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
  chrome.storage.local.get({ blockedLogs: [] }, (data) => {
    updateBadgeForTab(activeInfo.tabId, data.blockedLogs);
  });
});