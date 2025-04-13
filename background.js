// sidebar setup
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setOptions({ path: 'index.html' });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

function clearBadge(){
  console.log('Clearing badge...');
  chrome.action.setBadgeText({ text: '' });
  chrome.action.setBadgeBackgroundColor({ color: '#FFFFFF' });
  return true;
}

async function pingSidebar() {
  return new Promise((resolve) => {
    var isSidebarOpen = false; // Reset the flag before sending the message
    console.log('Pinging sidebar...');
    chrome.runtime.sendMessage({ type: "PING" }, (response) => {
      try{
        isSidebarOpen = response?.status == "PONG"? true: false;
        console.log('Sidebar is open:', isSidebarOpen);
        if(isSidebarOpen) clearBadge(); // Clear badge if sidebar is open
      }catch(e){
        console.error("Error in PING response", e);
        isSidebarOpen = true; // If the sidebar doesn't respond, assume it is open on another tab.
      }
      resolve(isSidebarOpen); // Resolve the promise regardless of the response
    });
  });
};

async function updateBadge(url, tabId) {
  try{
    const isSidebarOpen = await pingSidebar(); // Check if sidebar is open
    if (isSidebarOpen){
      clearBadge(); // Clear badge if sidebar is open
      return; // Don't update badge if sidebar is open
    }
    url = typeof url == 'string' ? url : url.toString();
    const ignore_prefixes = ['chrome://','file://','about:','data:','javascript:','view-source:','chrome-extension://'];
    if (url.length <= 0 || ignore_prefixes.some(prefix => url.startsWith(prefix))) {
      clearBadge(); // Clear badge for ignored URLs
      return; // Ignore URLs with specified prefixes
    }
    fetch('https://catsupnorth.com/get_url_thread_count', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url })
    })
    .then(response => response.json())
    .then(data => {
      console.log('Response from server:', data);
      try{
        const threadCount = data?.url_thread_count || 0;
        if (threadCount < 1){
          console.log('Thread count is less than 1, clearing badge...');
          clearBadge(); // Clear badge if thread count is less than 1
          return; // Exit early if thread count is less than 1
        }
        console.log('Setting badge thread count:', threadCount);
        chrome.action.setBadgeText({ text: (threadCount > 9 ? '9+' : threadCount.toString()), tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#FF6E6E', tabId });
      }catch(e){
        console.error("Error in parsing response", e);
      }
    })
    .catch(error => {
      console.error('Error fetching thread count:', error);
    });
  }catch(e){
    console.error("Error in updateBadge", e);
    return; // Exit early if error occurs
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

// Listen for message type "EXTENSION_OPENED" from the sidebar
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "EXTENSION_LOADED") {
    console.log('Extension sidebar loaded.');
    clearBadge(); // Clear badge when sidebar is opened
  }
});