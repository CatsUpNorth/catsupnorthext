// sidebar setup
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setOptions({ path: 'index.html' });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

async function pingSidebar() {
  return new Promise((resolve) => {
    var isSidebarOpen = false; // Reset the flag before sending the message
    console.log('Pinging sidebar...');
    try{
      chrome.runtime.sendMessage({ type: "PING" }, (response) => {
        try{
          isSidebarOpen = response?.status == "PONG"? true: false;
        }catch(e){
          isSidebarOpen = true; // If the sidebar doesn't respond, assume it is open on another tab.
          throw e;
        }
        console.log('Sidebar is open:', isSidebarOpen);
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
    console.log("Sidebar open?", isSidebarOpen);
    if (isSidebarOpen) {
      console.log("Sidebar is open, skipping badge update.");
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
        console.log('clearing badge, URL is empty or ignored:', url);
        await chrome.action.setBadgeText({ text: '' });
        await chrome.action.setBadgeBackgroundColor({ color: '#FFFFFF' });
        return true;
      }
  
      console.log("Fetching thread count for URL:", url);
      const response = await fetch('https://catsupnorth.com/get_url_thread_count', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
      });
  
      const data = await response.json();
      console.log('Response from server:', data);
  
      const threadCount = data?.url_thread_count || 0;
      if (threadCount < 1) {
        console.log('Thread count is less than 1, clearing badge...');
        await chrome.action.setBadgeText({ text: '' });
        await chrome.action.setBadgeBackgroundColor({ color: '#FFFFFF' });
        return true;
      }
  
      console.log('Setting badge thread count:', threadCount);
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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Listen for message type "EXTENSION_OPENED" from the sidebar
  if (request.type === "EXTENSION_LOADED") {
    console.log('Extension sidebar loaded.');
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setBadgeBackgroundColor({ color: '#FFFFFF' });
    return true;
  }
});