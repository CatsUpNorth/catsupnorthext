let msstrat_data = null;

function logTabUrl(tab) {
  const tabURL = tab?.url || null;
  if (!tabURL) return;
  chrome.runtime.sendMessage({ cunurl: tabURL });
}

function logMetadata(tab) {
  const tabId = tab?.id || tab?.tabId || null;
  if (!tabId) return;
  if (chrome.runtime.lastError || !tab || !tab.url || typeof tab.url != 'string') return;
  if (tab.url.startsWith('chrome://') || tab.url.startsWith('file://') || tab.url.startsWith('about:')) return;
  // Inject script into the tab to extract metadata
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: (msstrat) => {

      const base_domain = window.location.hostname;

      var msstrat_fallback = {
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
      };

      // Extract metadata from the page
      msstrat = msstrat || msstrat_fallback;

      // Check if base_domain is in the sites object
      var here_strat = null;
      if(msstrat.sites[base_domain]){
        here_strat = msstrat.sites[base_domain];
      }

      // See if strat is in the strats object
      var here_strat_obj = null;
      console.log(msstrat.strats);
      if(msstrat.strats[here_strat]){
        here_strat_obj = msstrat.strats[here_strat];
      }

      // if strat, override the use object with the site's use object one key at a time
      if(here_strat_obj){
        for(const prop in here_strat_obj){
          msstrat.use[prop] = here_strat_obj[prop];
        }
      }

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
      };
      console.log('Metadata extracted for link preview: ', metadata, msstrat);
      return metadata;
    },
    args: [msstrat_data]
  }, (results) => {
    chrome.runtime.sendMessage({ cunmetadata: ((results && results[0]?.result)? results[0].result : {}) });
  });
}

// sidebar version
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setOptions({ path: 'monitor.html'});
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  fetch(chrome.runtime.getURL('msstrat.json')).then((res) => res.json()).then((data) => {
    if(data) msstrat_data = data;
    console.log('Metadata starts loaded:', msstrat_data);
  }).catch((err) => {
    console.error('Error loading metadata strats:', err);
  });
});

// Monitor when a new tab is created
chrome.tabs.onCreated.addListener((tab) => { 
  logTabUrl(tab); // logs immediately when a tab is created
});

// Monitor when the active tab changes
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    logTabUrl(tab); // fetches the tab object and logs the URL
  });
});

// Monitor when a user navigates to a new page in the tab
chrome.webNavigation.onCompleted.addListener((details) => {
  chrome.tabs.get(details.tabId, (tab) => {
    logTabUrl(tab); // logs after navigation is completed
  });
});

// Monitor when the DOM loads on the active tab
chrome.webNavigation.onDOMContentLoaded.addListener((details) => {
  chrome.tabs.get(details.tabId, (tab) => {
    logMetadata(tab); // triggers logMetadata after DOM is loaded
  });
});