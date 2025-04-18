// sidebar setup
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setOptions({ path: 'index.html' });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

async function pingSidebar() {
  return new Promise((resolve) => {
    var isSidebarOpen = false; // Reset the flag before sending the message
    try{
      chrome.runtime.sendMessage({ type: "PING" }, (response) => {
        try{
          isSidebarOpen = response?.status == "PONG"? true: false;
        }catch(e){
          isSidebarOpen = true; // If the sidebar doesn't respond, assume it is open on another tab.
          throw e;
        }
        if(isSidebarOpen){
          chrome.action.setBadgeText({ text: '' });
          chrome.action.setBadgeBackgroundColor({ color: '#FFFFFF' });
        }
        resolve(isSidebarOpen); // Resolve the promise regardless of the response
      });
    }catch(e){
      console.error('Error pinging sidebar:', e);
      resolve(isSidebarOpen); // Resolve the promise with the assumption
    }
  });
}
async function updateBadge(url, tabId){
  try {
    const isSidebarOpen = await pingSidebar();
    if (isSidebarOpen) {
      await chrome.action.setBadgeText({ text: '' });
      await chrome.action.setBadgeBackgroundColor({ color: '#FFFFFF' });
    }else{
      url = typeof url === 'string' ? url : url.toString();
      const ignore_prefixes = [
        'chrome://',
        'file://',
        'about:',
        'data:',
        'javascript:',
        'view-source:',
        'chrome-extension://',
      ];
      if (
        url.length <= 0 ||
        ignore_prefixes.some((prefix) => url.startsWith(prefix))
      ) {
        await chrome.action.setBadgeText({ text: '' });
        await chrome.action.setBadgeBackgroundColor({ color: '#FFFFFF' });
        return true;
      }
  
      const response = await fetch('https://catsupnorth.com/get_url_thread_count', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
      });
  
      const data = await response.json();
  
      const threadCount = data?.url_thread_count || 0;
      if (threadCount < 1) {
        await chrome.action.setBadgeText({ text: '' });
        await chrome.action.setBadgeBackgroundColor({ color: '#FFFFFF' });
        return true;
      }
  
      await chrome.action.setBadgeText({
        text: threadCount > 9 ? '9+' : threadCount.toString(),
        tabId,
      });
      await chrome.action.setBadgeBackgroundColor({
        color: '#FF6E6E',
        tabId,
      });
  
    }
  } catch (e) {
    console.error('Error in updateBadge', e);
    return;
  }
}

// When a tab is updated, show thread count in badge
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url){
    updateBadge(tab.url, tabId);
    // tell chrome to wait for async response
    return true;
  }else{
    // do nothing, do not wait
    return false;
  }
});

// When a tab is activated, show thread count in badge
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (tab.url){
      updateBadge(tab.url, activeInfo.tabId);
      // tell chrome to wait for async response
      return true;
    }else{
      // do nothing, do not wait
      return false;
    }
  });
});

// Add a listener for sites that use pushState to change the URL without reloading the page.
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId === 0) { // Only for the main frame
    chrome.tabs.get(details.tabId, (tab) => {
      if (tab.url){
        updateBadge(tab.url, details.tabId);
        // tell chrome to wait for async response
        return true;
      }else{
        // do nothing, do not wait
        return false;
      }
    });
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Listen for message type "EXTENSION_OPENED" from the sidebar
  if (request.type === "EXTENSION_LOADED") {
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setBadgeBackgroundColor({ color: '#FFFFFF' });
    return true;
  }
});