// sidebar setup
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setOptions({ path: 'index.html' });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

async function pingSidebar() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "PING" }, (response) => {
      if (chrome.runtime.lastError) {
        resolve(false); // No response, sidebar likely closed
      } else if (response && response.type === "PONG") {
        resolve(true); // Sidebar responded, it's open
      } else {
        resolve(false); // Unexpected response, assume closed
      }
    });
  });
}

async function updateBadge(url, tabId) {
  const urlLength = url.length;
  // clear badge
  chrome.action.setBadgeText({ text: '', tabId });
  chrome.action.setBadgeBackgroundColor({ color: '#FFFFFF', tabId });

  // IMPORTANT: If the side panel is open, do not show the badge and do not ping the server
  try {
    const isSidebarOpen = await pingSidebar();
    if (isSidebarOpen) {
      return; // Exit early if sidebar is open
    }
  } catch (error) {
    console.error("Error pinging sidebar:", error);
    // Proceed assuming sidebar is closed if pinging fails
  }

  if( urlLength > 0) {
    fetch('https://catsupnorth.com/get_url_thread_count', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url })
    })
    .then(response => response.json())
    .then(data => {
      const threadCount = data?.url_thread_count || 0;
      if (threadCount < 1) return;
      chrome.action.setBadgeText({ text: (threadCount > 9 ? '9+' : threadCount.toString()), tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#FF6E6E', tabId });
    })
    .catch(error => {
      console.error('Error fetching thread count:', error);
    });
  }
}
// When a tab is updated, show the length of the url with setBadgeText
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) updateBadge(tab.url, tabId);
});
// When a tab is activated, show the length of the url with setBadgeText
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (tab.url) updateBadge(tab.url, activeInfo.tabId);
  });
});