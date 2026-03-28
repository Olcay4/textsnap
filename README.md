# TextSnap

> Draw a selection on any webpage and instantly copy the text using on-device OCR. 100% offline, 100% private.

## Features

- **Draw to capture** — click the extension icon, draw a rectangle over any part of the page, and the text is extracted instantly
- **Fully offline** — OCR runs locally using a bundled copy of [Tesseract.js](https://github.com/naptha/tesseract.js); no data is ever sent to a server
- **History** — up to 20 recent extractions are saved locally, accessible from the popup or the right-click context menu
- **Copy to clipboard** — one click copies the extracted text
- **Clear history** — remove individual entries or clear all history at any time

## Installation

### From the Chrome Web Store
*(link coming soon)*

### Manual / Developer install
1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the project folder

## How it works

1. Click the **TextSnap** icon in the toolbar (or right-click → New Capture)
2. A screenshot of the current tab is taken
3. Draw a rectangle over the text you want to extract
4. Tesseract.js runs OCR on the selected region entirely on your device
5. The extracted text appears in a panel — copy it or dismiss

## Permissions

| Permission | Reason |
|---|---|
| `activeTab` | Capture the current tab screenshot and inject the selection overlay |
| `scripting` | Inject the content script to render the crop selection UI |
| `offscreen` | Run Tesseract.js WebAssembly OCR in a Web Worker |
| `storage` | Save OCR history locally in the browser |
| `contextMenus` | Show history and capture options in the action context menu |

## Privacy

No data ever leaves your device. See [privacy-policy.md](privacy-policy.md) for full details.

## Tech stack

- Manifest V3 Chrome Extension
- [Tesseract.js](https://github.com/naptha/tesseract.js) (bundled, offline)
- Material Design 3 UI (vanilla JS, no frameworks)

## License

MIT
