document.getElementById('btn-open-panel')?.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.windowId && chrome.sidePanel) {
    chrome.sidePanel.open({ windowId: tab.windowId });
    window.close();
  }
});

document.getElementById('btn-quick-run')?.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'START_BATCH_EXECUTION' });
  window.close();
});
