let windowId;

/*
// popup version
chrome.action.onClicked.addListener(() => {
  if (!windowId) {
    chrome.windows.create({
      url: 'monitor.html',
      type: 'popup',
      width: 400,
      height: 300
    }, (window) => {
      windowId = window.id;
    });
  } else {
    chrome.windows.update(windowId, { focused: true });
  }
});
*/

// sidebar version
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setOptions({ path: 'monitor.html'});
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});
chrome.action.onClicked.addListener(async ({ tabId }) => {
  logTabUrl(tabId);
});

chrome.windows.onRemoved.addListener((id) => {
  if (id === windowId) {
    windowId = null;
  }
});

function logTabUrl(tabId) {
  chrome.tabs.get(tabId, (tab) => {
    if (tab && tab.url) {
      chrome.runtime.sendMessage({ url: tab.url });
    }
  });
}

// Monitor updates to any tab
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active) {
    logTabUrl(tabId);
  }
});

// Monitor when the active tab changes
chrome.tabs.onActivated.addListener((activeInfo) => {
  logTabUrl(activeInfo.tabId);
});