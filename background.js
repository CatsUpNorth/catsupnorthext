let windowId;

function logTabUrl(tabId) {
  chrome.tabs.get(tabId, (tab) => {
    if (tab && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('file://')) {
      // Inject script into the tab to extract metadata
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: () => {
          // Extract metadata from the page
          const metadata = {
            title: document.querySelector('meta[property="og:title"]')?.content ||
                   document.querySelector('title')?.innerText || 
                   '',
            description: document.querySelector('meta[name="description"]')?.content ||
                         document.querySelector('meta[property="og:description"]')?.content ||
                         '',
            author: document.querySelector('meta[name="author"]')?.content || 
                    '',
            favicon: document.querySelector('link[rel="icon"]')?.href ||
                     document.querySelector('link[rel="shortcut icon"]')?.href || 
                     '',
            datePublished: document.querySelector('meta[property="article:published_time"]')?.content || 
                           '',
            image: document.querySelector('meta[property="og:image"]')?.content || 
                   '',
            language: document.querySelector('html')?.lang ||  '',
          };
          return metadata;
        }
      }, (results) => {
        chrome.runtime.sendMessage({ url: tab.url, metadata: ((results && results[0]?.result)? results[0].result : {}) });
      });
    }
  });
}

// sidebar version
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setOptions({ path: 'monitor.html'});
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});
chrome.action.onClicked.addListener(async ({ tabId }) => {
  
});

chrome.windows.onRemoved.addListener((id) => {
  if (id === windowId) {
    windowId = null;
  }
});

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