document.getElementById('captureBtn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'start-capture' });
  window.close();
});
