// sidebar setup
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setOptions({ path: 'index.html' });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});