let windowId;

var msstrat = {
  sites: {},
  strats: {},
  use: {
    title: [
      'title@innerText',
      'meta[property="og:title"]',
      'meta[name="twitter:title"]'
    ],
    description: [
      'meta[name="description"]',
      'meta[property="og:description"]',
      'meta[name="twitter:description"]'
    ],
    author: [
      'meta[name="author"]',
      'ytd-video-owner-renderer .ytd-channel-name@innerText',
      '.ytd-video-owner-renderer .ytd-channel-name@innerText'
    ],
    favicon: [
      'link[rel="icon"]@href',
      'link[rel="shortcut icon"]@href',
      'link[rel="apple-touch-icon"]@href'
    ],
    date: [
      'meta[name="date"]',
      'meta[property="article:published_time"]',
      'meta[property="article:modified_time"]',
      'meta[property="og:updated_time"]',
      'meta[property="og:published_time"]'
    ],
    image: [
      'meta[property="og:image"]',
      'meta[name="twitter:image"]',
      'meta[name="twitter:card"]',
      'link[rel="preload"]@href'
    ],
    language: [
      'html@lang'
    ]
  }
}

function logTabUrl(tabId) {
  chrome.tabs.get(tabId, (tab) => {
    if (tab && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('file://')) {
      // Inject script into the tab to extract metadata
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: () => {
          // Extract metadata from the page
          var metadata = {};
          for(const prop in msstrat.use){
            const prop_obj = msstrat.use[prop];
            for(var i = 0; i < prop_obj.length; i++){
              if(metadata[prop] && typeof metadata[prop] == 'string' && metadata[prop].length) break;
              const strat_str = prop_obj[i];
              var [selector_preference, attr] = strat_str.split('@');
              var [selector, preference] = selector_preference.split('!');
              var el = document.querySelector(selector); // default to first element
              switch(preference){
                case 'widest':
                  // Loop through all elements and set el to the widest one
                  var widest = 0;
                  var els = document.querySelectorAll(selector);
                  for(var j = 0; j < els.length; j++){
                    if(els[j].offsetWidth > widest){
                      widest = els[j].offsetWidth;
                      el = els[j];
                    }
                  }
                case 'tallest':
                  // Loop through all elements and set el to the tallest one
                  var tallest = 0;
                  var els = document.querySelectorAll(selector);
                  for(var j = 0; j < els.length; j++){
                    if(els[j].offsetHeight > tallest){
                      tallest = els[j].offsetHeight;
                      el = els[j];
                    }
                  }
                default:;
              }
              switch(attr){
                case 'innerText':
                  metadata[prop] = el?.innerText;
                  break;
                case 'href':
                  metadata[prop] = el?.href;
                  break;
                case 'src':
                  metadata[prop] = el?.src;
                  break;
                case 'lang':
                  metadata[prop] = el?.lang;
                  break;
                default:
                  metadata[prop] = el?.content;
              }
            }
          }
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "startCatsUpNorth") {
    // Trigger your extension's functionality here
    console.log("Extension function triggered from webpage.");
    sendResponse({status: "Extension started"});
  }
});