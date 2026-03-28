// TextSnap - Service Worker
// Orchestrates: tab capture -> content script injection -> offscreen OCR

let offscreenReady = false;
let pendingOCR = null;

const HISTORY_KEY = 'sct_history';
const MAX_HISTORY = 20;

// Start capture immediately when the extension icon is clicked
chrome.action.onClicked.addListener(() => {
  handleCapture();
});

// Rebuild context menus on install and browser startup
chrome.runtime.onInstalled.addListener(() => refreshContextMenus());
chrome.runtime.onStartup.addListener(() => refreshContextMenus());

// Context menu item clicked
chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === 'sct-clear-history') {
    await chrome.storage.local.set({ [HISTORY_KEY]: [] });
    buildContextMenus([]);
    return;
  }
  if (info.menuItemId === 'sct-view-history' || String(info.menuItemId).startsWith('sct-hist-')) {
    const history = await getHistory();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    setTimeout(() => {
      chrome.tabs.sendMessage(tab.id, { action: 'show-history', history });
    }, 50);
  }
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.action === 'ocr-request') {
    handleOCR(message.imageData, sender.tab.id);
  } else if (message.action === 'start-capture') {
    handleCapture();
  } else if (message.action === 'clear-history') {
    chrome.storage.local.set({ [HISTORY_KEY]: [] }, () => buildContextMenus([]));
  } else if (message.action === 'remove-history-item') {
    getHistory().then((history) => {
      const updated = history.filter((e) => e.timestamp !== message.timestamp);
      chrome.storage.local.set({ [HISTORY_KEY]: updated }, () => buildContextMenus(updated));
    });
  } else if (message.action === 'offscreen-ready') {
    offscreenReady = true;
    if (pendingOCR) {
      chrome.runtime.sendMessage(pendingOCR);
      pendingOCR = null;
    }
  } else if (message.action === 'ocr-complete') {
    handleOCRComplete(message.text, message.tabId);
  }
});

async function handleCapture() {
  try {
    // Capture first — must happen before any other await to keep the
    // activeTab gesture grant alive on a cold service-worker start.
    const screenshot = await chrome.tabs.captureVisibleTab(null, { format: 'png' });

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    // Inject content script
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });

    // Give content script a moment to set up its listener
    setTimeout(() => {
      chrome.tabs.sendMessage(tab.id, {
        action: 'show-overlay',
        screenshot: screenshot,
      });
    }, 50);
  } catch (err) {
    console.error('TextSnap: capture failed', err);
  }
}

async function handleOCR(imageDataUrl, tabId) {
  try {
    await setupOffscreenDocument();

    const ocrMessage = {
      action: 'perform-ocr',
      image: imageDataUrl,
      tabId: tabId,
    };

    if (offscreenReady) {
      chrome.runtime.sendMessage(ocrMessage);
    } else {
      pendingOCR = ocrMessage;
    }
  } catch (err) {
    console.error('TextSnap: OCR setup failed', err);
    chrome.tabs.sendMessage(tabId, {
      action: 'ocr-result',
      text: '[Error: Could not start OCR. ' + err.message + ']',
      history: [],
    });
  }
}

async function setupOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });

  if (existing.length > 0) {
    offscreenReady = true;
    return;
  }

  offscreenReady = false;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['WORKERS'],
    justification: 'Run Tesseract.js OCR in a Web Worker',
  });
}

// --- History ---

async function getHistory() {
  const result = await chrome.storage.local.get(HISTORY_KEY);
  return result[HISTORY_KEY] || [];
}

async function saveToHistory(text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const history = await getHistory();
  history.unshift({ text: trimmed, timestamp: Date.now() });
  if (history.length > MAX_HISTORY) history.splice(MAX_HISTORY);
  await chrome.storage.local.set({ [HISTORY_KEY]: history });
}

async function refreshContextMenus() {
  const history = await getHistory();
  buildContextMenus(history);
}

function buildContextMenus(history) {
  chrome.contextMenus.removeAll(() => {
    // Always show "View Full History" at the top
    chrome.contextMenus.create({
      id: 'sct-view-history',
      title: '\uD83D\uDCCB View Full History',
      contexts: ['action'],
      enabled: history.length > 0,
    });

    if (history.length === 0) {
      chrome.contextMenus.create({
        id: 'sct-no-history',
        title: 'No history yet',
        contexts: ['action'],
        enabled: false,
      });
      return;
    }

    chrome.contextMenus.create({ id: 'sct-sep-top', type: 'separator', contexts: ['action'] });

    chrome.contextMenus.create({
      id: 'sct-label',
      title: `Recent (${history.length} item${history.length === 1 ? '' : 's'})`,
      contexts: ['action'],
      enabled: false,
    });

    history.slice(0, 10).forEach((entry, i) => {
      const preview = entry.text.replace(/\s+/g, ' ').trim().slice(0, 55);
      const label = entry.text.trim().length > 55 ? preview + '\u2026' : preview;
      chrome.contextMenus.create({
        id: `sct-hist-${i}`,
        title: label,
        contexts: ['action'],
      });
    });

    chrome.contextMenus.create({ id: 'sct-sep', type: 'separator', contexts: ['action'] });
    chrome.contextMenus.create({
      id: 'sct-clear-history',
      title: 'Clear History',
      contexts: ['action'],
    });
  });
}

async function handleOCRComplete(text, tabId) {
  await saveToHistory(text);
  const history = await getHistory();
  buildContextMenus(history);
  chrome.tabs.sendMessage(tabId, {
    action: 'ocr-result',
    text: text,
    history: history,
  });
}
