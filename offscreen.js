// TextSnap - Offscreen OCR document
// This runs in an extension page context where Web Workers and WASM are available

// Signal to the service worker that we're ready to receive messages
chrome.runtime.sendMessage({ action: 'offscreen-ready' });

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'perform-ocr') {
    performOCR(message.image, message.tabId);
  }
});

function errMsg(e) {
  if (!e) return 'Unknown error';
  if (typeof e === 'string') return e;
  if (e.message) return e.message;
  try { return JSON.stringify(e); } catch (_) { return String(e); }
}

async function performOCR(imageDataUrl, tabId) {
  // workerBlobURL: false is required in Chrome extensions —
  // blob: URL workers are blocked by extension CSP.
  const baseOptions = {
    workerPath: chrome.runtime.getURL('lib/worker.min.js'),
    workerBlobURL: false,
  };

  let worker = null;

  // First attempt: SIMD-optimised WASM core
  try {
    worker = await Tesseract.createWorker('eng', 1, {
      ...baseOptions,
      corePath: chrome.runtime.getURL('lib/tesseract-core-simd.wasm.js'),
    });
    const { data: { text } } = await worker.recognize(imageDataUrl);
    await worker.terminate();
    chrome.runtime.sendMessage({ action: 'ocr-complete', text, tabId });
    return;
  } catch (error) {
    console.error('TextSnap OCR (SIMD) error:', error, errMsg(error));
    try { await worker?.terminate(); } catch (_) {}
    worker = null;
  }

  // Second attempt: non-SIMD fallback core
  try {
    worker = await Tesseract.createWorker('eng', 1, {
      ...baseOptions,
      corePath: chrome.runtime.getURL('lib/tesseract-core.wasm.js'),
    });
    const { data: { text } } = await worker.recognize(imageDataUrl);
    await worker.terminate();
    chrome.runtime.sendMessage({ action: 'ocr-complete', text, tabId });
  } catch (fallbackError) {
    console.error('TextSnap OCR (fallback) error:', fallbackError, errMsg(fallbackError));
    try { await worker?.terminate(); } catch (_) {}
    chrome.runtime.sendMessage({
      action: 'ocr-complete',
      text: '[OCR Error: ' + errMsg(fallbackError) + ']',
      tabId,
    });
  }
}
