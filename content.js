// TextSnap - Content Script (Material Design 3)
// Handles: selection overlay, image cropping, and results display

(() => {
  // Guard against duplicate injection
  if (window.__textSnapExtension) return;
  window.__textSnapExtension = true;

  const FONT = "'Nunito', system-ui, -apple-system, sans-serif";

  // MD3 Design Tokens
  const C = {
    primary:              '#6750A4',
    onPrimary:            '#FFFFFF',
    primaryContainer:     '#EADDFF',
    onPrimaryContainer:   '#21005D',
    secondary:            '#625B71',
    secondaryContainer:   '#E8DEF8',
    onSecondaryContainer: '#1D192B',
    surface:              '#FFFBFE',
    surfaceContainer:     '#F3EDF7',
    onSurface:            '#1C1B1F',
    onSurfaceVariant:     '#49454F',
    outline:              '#79747E',
    outlineVariant:       '#CAC4D0',
    error:                '#B3261E',
    errorContainer:       '#F9DEDC',
    inverseSurface:       '#313033',
    inverseOnSurface:     '#F4EFF4',
  };

  const SHAPE = {
    small:  '8px',
    medium: '12px',
    large:  '16px',
    xlarge: '28px',
    full:   '9999px',
  };

  const EASE = 'cubic-bezier(0.2, 0, 0, 1)';

  // Safe wrapper — silently swallows "Extension context invalidated" errors
  // that occur when the extension is reloaded while the content script is still alive.
  function safeSend(msg) {
    try {
      chrome.runtime.sendMessage(msg);
    } catch (e) {
      if (!e.message || !e.message.includes('Extension context invalidated')) {
        console.warn('TextSnap: sendMessage failed', e);
      }
    }
  }

  // Style injection

  function injectFont() {
    if (document.getElementById('textsnap-font')) return;
    const s = document.createElement('style');
    s.id = 'textsnap-font';
    s.textContent = `
      @font-face {
        font-family: 'Nunito';
        font-style: normal;
        font-weight: 100 900;
        src: url('${chrome.runtime.getURL('fonts/Nunito-Regular.woff2')}') format('woff2');
      }
    `;
    (document.head || document.documentElement).appendChild(s);
  }

  function injectKeyframes() {
    if (document.getElementById('textsnap-keyframes')) return;
    const s = document.createElement('style');
    s.id = 'textsnap-keyframes';
    s.textContent = `
      @keyframes sct-spin {
        to { transform: rotate(360deg); }
      }
      @keyframes sct-panel-in {
        from { opacity: 0; transform: translateY(10px) scale(0.97); }
        to   { opacity: 1; transform: translateY(0)   scale(1);    }
      }
    `;
    (document.head || document.documentElement).appendChild(s);
  }

  // Message listener

  try {
    chrome.runtime.onMessage.addListener((message) => {
      if (message.action === 'show-overlay') {
        startSelection(message.screenshot);
      } else if (message.action === 'ocr-result') {
        hideProcessing();
        showResults(message.text, message.history || []);
      } else if (message.action === 'show-history') {
        showHistoryPanel(message.history || []);
      }
    });
  } catch (e) {
    // Extension context already invalidated — bail out silently.
    return;
  }

  // Selection overlay

  function startSelection(screenshotDataUrl) {
    removeExisting();
    injectFont();
    injectKeyframes();

    const overlay = document.createElement('div');
    overlay.id = 'sct-overlay';
    Object.assign(overlay.style, {
      position: 'fixed', top: '0', left: '0',
      width: '100vw', height: '100vh',
      zIndex: '2147483647',
      cursor: 'crosshair',
      margin: '0', padding: '0',
    });

    const dpr = window.devicePixelRatio || 1;
    const canvas = document.createElement('canvas');
    canvas.width  = window.innerWidth  * dpr;
    canvas.height = window.innerHeight * dpr;
    Object.assign(canvas.style, {
      position: 'absolute', top: '0', left: '0',
      width: '100%', height: '100%',
    });
    overlay.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    drawOverlay(ctx, null);

    // MD3 pill-shaped instruction chip
    const instruction = document.createElement('div');
    Object.assign(instruction.style, {
      position: 'absolute', top: '20px', left: '50%',
      transform: 'translateX(-50%)',
      background: C.inverseSurface,
      color: C.inverseOnSurface,
      padding: '10px 24px',
      borderRadius: SHAPE.full,
      fontSize: '13px', fontFamily: FONT,
      fontWeight: '500', letterSpacing: '0.1px',
      pointerEvents: 'none', userSelect: 'none',
      whiteSpace: 'nowrap',
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    });
    instruction.textContent = chrome.i18n.getMessage('selectInstruction');
    overlay.appendChild(instruction);

    let isDrawing = false, startX, startY;

    canvas.addEventListener('mousedown', (e) => {
      isDrawing = true;
      startX = e.clientX;
      startY = e.clientY;
    });

    canvas.addEventListener('mousemove', (e) => {
      if (!isDrawing) return;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      drawOverlay(ctx, {
        x: Math.min(startX, e.clientX),
        y: Math.min(startY, e.clientY),
        w: Math.abs(e.clientX - startX),
        h: Math.abs(e.clientY - startY),
      });
    });

    canvas.addEventListener('mouseup', (e) => {
      if (!isDrawing) return;
      isDrawing = false;
      const w = Math.abs(e.clientX - startX);
      const h = Math.abs(e.clientY - startY);
      if (w < 10 || h < 10) return;
      const x = Math.min(startX, e.clientX);
      const y = Math.min(startY, e.clientY);
      cropAndSend(screenshotDataUrl, x, y, w, h, overlay);
    });

    function escHandler(e) {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', escHandler);
      }
    }
    document.addEventListener('keydown', escHandler);

    document.documentElement.appendChild(overlay);
  }

  function drawOverlay(ctx, sel) {
    const W = window.innerWidth, H = window.innerHeight;
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, W, H);

    if (sel && sel.w > 0 && sel.h > 0) {
      ctx.clearRect(sel.x, sel.y, sel.w, sel.h);

      // MD3 primary dashed border
      ctx.save();
      ctx.strokeStyle = C.primary;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
      ctx.restore();

      // Corner handles
      const hs = 8;
      ctx.fillStyle = C.primary;
      [[sel.x, sel.y], [sel.x + sel.w, sel.y],
       [sel.x, sel.y + sel.h], [sel.x + sel.w, sel.y + sel.h]].forEach((pt) => {
        ctx.fillRect(pt[0] - hs / 2, pt[1] - hs / 2, hs, hs);
      });

      // Dimension label
      if (sel.w > 50 && sel.h > 20) {
        const label = Math.round(sel.w) + ' \u00d7 ' + Math.round(sel.h);
        ctx.font = '500 12px ' + FONT;
        ctx.fillStyle = C.primaryContainer;
        ctx.textAlign = 'center';
        const lx = sel.x + sel.w / 2;
        const ly = sel.y > 26 ? sel.y - 10 : sel.y + sel.h + 20;
        ctx.fillText(label, lx, ly);
        ctx.textAlign = 'left';
      }
    }
  }

  function cropAndSend(screenshotDataUrl, x, y, w, h, overlay) {
    const dpr = window.devicePixelRatio || 1;
    overlay.remove();
    showProcessing();

    const img = new Image();
    img.onload = () => {
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width  = w * dpr;
      cropCanvas.height = h * dpr;
      const cCtx = cropCanvas.getContext('2d');
      cCtx.drawImage(img, x * dpr, y * dpr, w * dpr, h * dpr, 0, 0, w * dpr, h * dpr);
      safeSend({
        action: 'ocr-request',
        imageData: cropCanvas.toDataURL('image/png'),
      });
    };
    img.src = screenshotDataUrl;
  }

  // Processing indicator

  function showProcessing() {
    removeElement('sct-processing');
    injectKeyframes();

    const backdrop = document.createElement('div');
    backdrop.id = 'sct-processing';
    Object.assign(backdrop.style, {
      position: 'fixed', inset: '0',
      background: 'rgba(0, 0, 0, 0.32)',
      zIndex: '2147483647',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    });

    // MD3 Surface Container card
    const card = document.createElement('div');
    Object.assign(card.style, {
      background: C.surfaceContainer,
      borderRadius: SHAPE.xlarge,
      padding: '36px 48px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px',
      boxShadow: '0 2px 6px rgba(0,0,0,0.1), 0 8px 24px rgba(0,0,0,0.12)',
      fontFamily: FONT,
    });

    // MD3 circular indeterminate progress indicator
    const spinner = document.createElement('div');
    Object.assign(spinner.style, {
      width: '48px', height: '48px',
      borderRadius: '50%',
      border: '4px solid ' + C.outlineVariant,
      borderTopColor: C.primary,
      animation: 'sct-spin 900ms linear infinite',
    });

    const label = document.createElement('div');
    label.textContent = chrome.i18n.getMessage('extractingText');
    Object.assign(label.style, {
      fontSize: '14px', fontWeight: '500',
      lineHeight: '20px', letterSpacing: '0.1px',
      color: C.onSurface, fontFamily: FONT,
    });

    card.appendChild(spinner);
    card.appendChild(label);
    backdrop.appendChild(card);
    document.documentElement.appendChild(backdrop);
  }

  function hideProcessing() {
    removeElement('sct-processing');
  }

  // Results panel

  function showResults(text, history) {
    removeElement('sct-results');
    injectFont();
    injectKeyframes();

    // MD3 Card (Surface, elevation level 1)
    const panel = document.createElement('div');
    panel.id = 'sct-results';
    Object.assign(panel.style, {
      position: 'fixed', top: '20px', right: '20px',
      background: C.surface,
      borderRadius: SHAPE.xlarge,
      boxShadow: '0 1px 3px rgba(0,0,0,0.1), 0 4px 16px rgba(0,0,0,0.08)',
      zIndex: '2147483647',
      maxWidth: '440px', minWidth: '320px', maxHeight: '80vh',
      fontFamily: FONT,
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      animation: 'sct-panel-in 200ms cubic-bezier(0.2, 0, 0, 1) both',
    });

    // Tonal surface elevation overlay (level 1: primary at 5%)
    const tonalOverlay = document.createElement('div');
    Object.assign(tonalOverlay.style, {
      position: 'absolute', inset: '0',
      background: 'rgba(103, 80, 164, 0.05)',
      borderRadius: 'inherit',
      pointerEvents: 'none', zIndex: '0',
    });
    panel.appendChild(tonalOverlay);

    makeDraggable(panel);

    // Header
    const header = document.createElement('div');
    Object.assign(header.style, {
      position: 'relative', zIndex: '1',
      display: 'flex', alignItems: 'center', gap: '4px',
      padding: '8px 8px 8px 24px',
      minHeight: '64px', boxSizing: 'border-box',
      cursor: 'move',
    });

    const title = document.createElement('div');
    title.textContent = chrome.i18n.getMessage('appName');
    Object.assign(title.style, {
      flex: '1',
      fontSize: '22px', fontWeight: '400',
      lineHeight: '28px', letterSpacing: '0',
      color: C.onSurface, fontFamily: FONT,
    });

    // Tonal "New Capture" button
    const recaptureBtn = document.createElement('button');
    recaptureBtn.textContent = chrome.i18n.getMessage('newCapture');
    Object.assign(recaptureBtn.style, {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      height: '36px', padding: '0 16px',
      background: C.secondaryContainer, color: C.onSecondaryContainer,
      border: 'none', borderRadius: SHAPE.full,
      fontFamily: FONT, fontSize: '13px', fontWeight: '500', letterSpacing: '0.1px',
      cursor: 'pointer', flexShrink: '0',
      transition: 'background 150ms ' + EASE,
      marginRight: '4px',
    });
    recaptureBtn.addEventListener('mouseenter', () => { recaptureBtn.style.background = '#D6CCE8'; });
    recaptureBtn.addEventListener('mouseleave', () => { recaptureBtn.style.background = C.secondaryContainer; });
    recaptureBtn.addEventListener('click', () => {
      panel.remove();
      safeSend({ action: 'start-capture' });
    });

    const closeBtn = makeIconButton('\u2715', chrome.i18n.getMessage('close'));
    closeBtn.addEventListener('click', () => panel.remove());

    header.appendChild(title);
    header.appendChild(recaptureBtn);
    header.appendChild(closeBtn);

    // Divider
    const divider = document.createElement('div');
    Object.assign(divider.style, {
      position: 'relative', zIndex: '1',
      height: '1px', background: C.outlineVariant,
    });

    // Scrollable body
    const body = document.createElement('div');
    Object.assign(body.style, {
      position: 'relative', zIndex: '1',
      padding: '20px 24px 24px',
      flex: '1', overflowY: 'auto',
      display: 'flex', flexDirection: 'column',
    });

    // Outlined text field style textarea
    const textarea = document.createElement('textarea');
    textarea.value = text.trim();
    Object.assign(textarea.style, {
      width: '100%', minHeight: '140px',
      border: '1px solid ' + C.outline,
      borderRadius: SHAPE.small,
      padding: '16px',
      fontSize: '14px', lineHeight: '20px', letterSpacing: '0.25px',
      resize: 'vertical', fontFamily: FONT,
      boxSizing: 'border-box', outline: 'none',
      color: C.onSurface, background: 'transparent',
      transition: 'border-color 200ms ' + EASE,
    });
    textarea.addEventListener('mouseenter', () => {
      if (document.activeElement !== textarea) textarea.style.borderColor = C.onSurface;
    });
    textarea.addEventListener('mouseleave', () => {
      if (document.activeElement !== textarea) textarea.style.borderColor = C.outline;
    });
    textarea.addEventListener('focus', () => {
      textarea.style.borderColor = C.primary;
      textarea.style.borderWidth = '2px';
      textarea.style.padding = '15px';
    });
    textarea.addEventListener('blur', () => {
      textarea.style.borderColor = C.outline;
      textarea.style.borderWidth = '1px';
      textarea.style.padding = '16px';
    });

    // Button row
    const btnRow = document.createElement('div');
    Object.assign(btnRow.style, {
      display: 'flex', gap: '8px',
      marginTop: '16px', alignItems: 'center',
    });

    const copyBtn = makeFilledButton(chrome.i18n.getMessage('copyToClipboard'));
    copyBtn.style.flex = '1';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(textarea.value).then(() => {
        copyBtn.textContent = chrome.i18n.getMessage('copiedBang');
        copyBtn.style.background = '#2E7D32';
        setTimeout(() => {
          copyBtn.textContent = chrome.i18n.getMessage('copyToClipboard');
          copyBtn.style.background = C.primary;
        }, 2000);
      });
    });

    const dismissBtn = makeOutlinedButton(chrome.i18n.getMessage('close'));
    dismissBtn.addEventListener('click', () => panel.remove());

    btnRow.appendChild(copyBtn);
    btnRow.appendChild(dismissBtn);
    body.appendChild(textarea);
    body.appendChild(btnRow);

    // History section
    const prevItems = (history || []).slice(1);
    if (prevItems.length > 0) {
      const histDivider = document.createElement('div');
      Object.assign(histDivider.style, {
        height: '1px', background: C.outlineVariant, margin: '20px 0 14px',
      });

      const histLabel = document.createElement('div');
      histLabel.textContent = chrome.i18n.getMessage('previousExtractions');
      Object.assign(histLabel.style, {
        fontSize: '11px', fontWeight: '600',
        letterSpacing: '1px', textTransform: 'uppercase',
        color: C.onSurfaceVariant, fontFamily: FONT,
        marginBottom: '4px',
      });

      const histList = document.createElement('div');
      Object.assign(histList.style, {
        maxHeight: '200px', overflowY: 'auto',
        display: 'flex', flexDirection: 'column',
      });

      const itemsToShow = prevItems.slice(0, 9);
      itemsToShow.forEach((entry, idx) => {
        const row = document.createElement('div');
        Object.assign(row.style, {
          display: 'flex', alignItems: 'flex-start', gap: '8px',
          padding: '10px 0',
          borderBottom: idx < itemsToShow.length - 1
            ? '1px solid ' + C.outlineVariant : 'none',
        });

        const textCol = document.createElement('div');
        Object.assign(textCol.style, { flex: '1', minWidth: '0', overflow: 'hidden' });

        const textPart = document.createElement('div');
        textPart.textContent = entry.text.trim();
        Object.assign(textPart.style, {
          fontSize: '13px', lineHeight: '1.4',
          color: C.onSurface, fontFamily: FONT,
          display: '-webkit-box', WebkitLineClamp: '2', WebkitBoxOrient: 'vertical',
          overflow: 'hidden', wordBreak: 'break-word',
        });

        const timeEl = document.createElement('div');
        timeEl.textContent = formatTime(entry.timestamp);
        Object.assign(timeEl.style, {
          fontSize: '11px', color: C.onSurfaceVariant,
          marginTop: '4px', fontFamily: FONT,
        });

        textCol.appendChild(textPart);
        textCol.appendChild(timeEl);

        const btnGroup = document.createElement('div');
        Object.assign(btnGroup.style, {
          display: 'flex', gap: '6px', flexShrink: '0', alignItems: 'center',
        });

        const hCopyBtn = makeSmallTonalButton(chrome.i18n.getMessage('copy'));
        hCopyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(entry.text).then(() => {
            hCopyBtn.textContent = '\u2713';
            setTimeout(() => { hCopyBtn.textContent = chrome.i18n.getMessage('copy'); }, 1500);
          });
        });

        const hRemoveBtn = makeSmallErrorButton('\u2715');
        hRemoveBtn.addEventListener('click', () => {
          safeSend({ action: 'remove-history-item', timestamp: entry.timestamp });
          row.remove();
        });

        btnGroup.appendChild(hCopyBtn);
        btnGroup.appendChild(hRemoveBtn);
        row.appendChild(textCol);
        row.appendChild(btnGroup);
        histList.appendChild(row);
      });

      // Text button - Clear History
      const clearBtn = document.createElement('button');
      clearBtn.textContent = chrome.i18n.getMessage('clearHistory');
      Object.assign(clearBtn.style, {
        alignSelf: 'flex-start', marginTop: '12px',
        height: '36px', padding: '0 12px',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'transparent', color: C.error,
        border: 'none', borderRadius: SHAPE.full,
        fontFamily: FONT, fontSize: '13px', fontWeight: '500', letterSpacing: '0.1px',
        cursor: 'pointer', transition: 'background 150ms ' + EASE,
      });
      clearBtn.addEventListener('mouseenter', () => { clearBtn.style.background = 'rgba(179, 38, 30, 0.08)'; });
      clearBtn.addEventListener('mouseleave', () => { clearBtn.style.background = 'transparent'; });
      clearBtn.addEventListener('click', () => {
        safeSend({ action: 'clear-history' });
        panel.remove();
      });

      // Scroll-fade wrapper for history list
      const histWrap = document.createElement('div');
      Object.assign(histWrap.style, { position: 'relative' });
      histWrap.appendChild(histList);
      const histFade = document.createElement('div');
      Object.assign(histFade.style, {
        position: 'absolute', bottom: '0', left: '0', right: '0',
        height: '48px', pointerEvents: 'none',
        background: 'linear-gradient(to bottom, transparent, ' + C.surface + ')',
        transition: 'opacity 200ms ' + EASE, opacity: '0',
      });
      histWrap.appendChild(histFade);
      histList.addEventListener('scroll', () => {
        const atBottom = histList.scrollHeight - histList.scrollTop <= histList.clientHeight + 2;
        histFade.style.opacity = atBottom ? '0' : '1';
      });
      setTimeout(() => {
        histFade.style.opacity = histList.scrollHeight > histList.clientHeight ? '1' : '0';
      }, 0);

      body.appendChild(histDivider);
      body.appendChild(histLabel);
      body.appendChild(histWrap);
      body.appendChild(clearBtn);
    }

    panel.appendChild(header);
    panel.appendChild(divider);
    panel.appendChild(body);
    document.documentElement.appendChild(panel);
  }

  // History panel

  function showHistoryPanel(history) {
    removeElement('sct-history-panel');
    removeElement('sct-results');
    injectFont();
    injectKeyframes();

    const panel = document.createElement('div');
    panel.id = 'sct-history-panel';
    Object.assign(panel.style, {
      position: 'fixed', top: '20px', right: '20px',
      background: C.surface,
      borderRadius: SHAPE.xlarge,
      boxShadow: '0 1px 3px rgba(0,0,0,0.1), 0 4px 16px rgba(0,0,0,0.08)',
      zIndex: '2147483647',
      maxWidth: '440px', minWidth: '320px', maxHeight: '80vh',
      fontFamily: FONT,
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      animation: 'sct-panel-in 200ms cubic-bezier(0.2, 0, 0, 1) both',
    });

    const tonalOverlay = document.createElement('div');
    Object.assign(tonalOverlay.style, {
      position: 'absolute', inset: '0',
      background: 'rgba(103, 80, 164, 0.05)',
      borderRadius: 'inherit',
      pointerEvents: 'none', zIndex: '0',
    });
    panel.appendChild(tonalOverlay);

    makeDraggable(panel);

    // Header
    const header = document.createElement('div');
    Object.assign(header.style, {
      position: 'relative', zIndex: '1',
      display: 'flex', alignItems: 'center', gap: '4px',
      padding: '8px 8px 8px 24px',
      minHeight: '64px', boxSizing: 'border-box',
      cursor: 'move',
    });

    const title = document.createElement('div');
    title.textContent = chrome.i18n.getMessage('history');
    Object.assign(title.style, {
      flex: '1', fontSize: '22px', fontWeight: '400',
      lineHeight: '28px', color: C.onSurface, fontFamily: FONT,
    });

    const closeBtn = makeIconButton('\u2715', chrome.i18n.getMessage('close'));
    closeBtn.addEventListener('click', () => panel.remove());

    header.appendChild(title);
    header.appendChild(closeBtn);

    // Divider
    const divider = document.createElement('div');
    Object.assign(divider.style, {
      position: 'relative', zIndex: '1',
      height: '1px', background: C.outlineVariant,
    });

    // Body
    const body = document.createElement('div');
    Object.assign(body.style, {
      position: 'relative', zIndex: '1',
      padding: '16px 24px 24px',
      flex: '1', overflowY: 'auto',
      display: 'flex', flexDirection: 'column',
    });

    if (history.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = chrome.i18n.getMessage('noHistory');
      Object.assign(empty.style, {
        fontSize: '14px', lineHeight: '20px',
        color: C.onSurfaceVariant, fontFamily: FONT,
        textAlign: 'center', padding: '40px 0',
      });
      body.appendChild(empty);
    } else {
      history.forEach((entry, idx) => {
        const item = document.createElement('div');
        Object.assign(item.style, {
          padding: '12px 0',
          borderBottom: idx < history.length - 1 ? '1px solid ' + C.outlineVariant : 'none',
          display: 'flex', flexDirection: 'column', gap: '8px',
        });

        const timeEl = document.createElement('div');
        timeEl.textContent = formatTime(entry.timestamp);
        Object.assign(timeEl.style, {
          fontSize: '11px', color: C.onSurfaceVariant,
          fontFamily: FONT, letterSpacing: '0.4px',
        });

        const textEl = document.createElement('div');
        textEl.textContent = entry.text.trim();
        Object.assign(textEl.style, {
          fontSize: '13px', color: C.onSurface, lineHeight: '1.5',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          maxHeight: '80px', overflowY: 'auto', fontFamily: FONT,
        });

        const itemBtnRow = document.createElement('div');
        Object.assign(itemBtnRow.style, {
          display: 'flex', gap: '8px', justifyContent: 'flex-end',
        });

        const itemCopyBtn = makeSmallTonalButton(chrome.i18n.getMessage('copy'));
        itemCopyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(entry.text).then(() => {
            itemCopyBtn.textContent = chrome.i18n.getMessage('copiedShort');
            setTimeout(() => { itemCopyBtn.textContent = chrome.i18n.getMessage('copy'); }, 1500);
          });
        });

        const itemRemoveBtn = makeSmallErrorButton(chrome.i18n.getMessage('remove'));
        itemRemoveBtn.addEventListener('click', () => {
          safeSend({ action: 'remove-history-item', timestamp: entry.timestamp });
          item.remove();
        });

        itemBtnRow.appendChild(itemCopyBtn);
        itemBtnRow.appendChild(itemRemoveBtn);
        item.appendChild(timeEl);
        item.appendChild(textEl);
        item.appendChild(itemBtnRow);
        body.appendChild(item);
      });
    }

    panel.appendChild(header);
    panel.appendChild(divider);
    panel.appendChild(body);

    // Bottom scroll-fade for history list
    const bodyFade = document.createElement('div');
    Object.assign(bodyFade.style, {
      position: 'absolute', bottom: '0', left: '0', right: '0',
      height: '56px', pointerEvents: 'none', zIndex: '2',
      background: 'linear-gradient(to bottom, transparent, ' + C.surface + ')',
      transition: 'opacity 200ms ' + EASE, opacity: '0',
      borderBottomLeftRadius: SHAPE.xlarge,
      borderBottomRightRadius: SHAPE.xlarge,
    });
    panel.appendChild(bodyFade);
    body.addEventListener('scroll', () => {
      const atBottom = body.scrollHeight - body.scrollTop <= body.clientHeight + 2;
      bodyFade.style.opacity = atBottom ? '0' : '1';
    });
    setTimeout(() => {
      bodyFade.style.opacity = body.scrollHeight > body.clientHeight ? '1' : '0';
    }, 0);

    document.documentElement.appendChild(panel);
  }

  // Button factories

  function makeFilledButton(text) {
    const btn = document.createElement('button');
    btn.textContent = text;
    Object.assign(btn.style, {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '40px', padding: '0 24px',
      background: C.primary, color: C.onPrimary,
      border: 'none', borderRadius: SHAPE.full,
      fontFamily: FONT, fontSize: '14px', fontWeight: '500', letterSpacing: '0.1px',
      cursor: 'pointer', boxSizing: 'border-box',
      transition: 'background 150ms ' + EASE + ', box-shadow 200ms ' + EASE,
    });
    btn.addEventListener('mouseenter', () => {
      btn.style.background = '#7B61B7';
      btn.style.boxShadow = '0 1px 3px rgba(0,0,0,0.2), 0 2px 6px rgba(0,0,0,0.12)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = C.primary;
      btn.style.boxShadow = 'none';
    });
    return btn;
  }

  function makeOutlinedButton(text) {
    const btn = document.createElement('button');
    btn.textContent = text;
    Object.assign(btn.style, {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '40px', padding: '0 24px',
      background: 'transparent', color: C.primary,
      border: '1px solid ' + C.outline, borderRadius: SHAPE.full,
      fontFamily: FONT, fontSize: '14px', fontWeight: '500', letterSpacing: '0.1px',
      cursor: 'pointer', boxSizing: 'border-box',
      transition: 'background 150ms ' + EASE,
    });
    btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(103, 80, 164, 0.08)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
    return btn;
  }

  function makeIconButton(icon, label) {
    const btn = document.createElement('button');
    btn.textContent = icon;
    btn.setAttribute('aria-label', label);
    Object.assign(btn.style, {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: '40px', height: '40px',
      background: 'transparent', color: C.onSurfaceVariant,
      border: 'none', borderRadius: SHAPE.full,
      cursor: 'pointer', fontSize: '16px', flexShrink: '0',
      transition: 'background 150ms ' + EASE + ', color 150ms ' + EASE,
    });
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(28, 27, 31, 0.08)';
      btn.style.color = C.onSurface;
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'transparent';
      btn.style.color = C.onSurfaceVariant;
    });
    return btn;
  }

  function makeSmallTonalButton(text) {
    const btn = document.createElement('button');
    btn.textContent = text;
    Object.assign(btn.style, {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      height: '32px', padding: '0 14px',
      background: C.secondaryContainer, color: C.onSecondaryContainer,
      border: 'none', borderRadius: SHAPE.full,
      fontFamily: FONT, fontSize: '12px', fontWeight: '500', letterSpacing: '0.5px',
      cursor: 'pointer', flexShrink: '0',
      transition: 'background 150ms ' + EASE,
    });
    btn.addEventListener('mouseenter', () => { btn.style.background = '#D6CCE8'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = C.secondaryContainer; });
    return btn;
  }

  function makeSmallErrorButton(text) {
    const btn = document.createElement('button');
    btn.textContent = text;
    Object.assign(btn.style, {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      height: '32px', padding: '0 14px',
      background: C.errorContainer, color: C.error,
      border: 'none', borderRadius: SHAPE.full,
      fontFamily: FONT, fontSize: '12px', fontWeight: '500', letterSpacing: '0.5px',
      cursor: 'pointer', flexShrink: '0',
      transition: 'background 150ms ' + EASE,
    });
    btn.addEventListener('mouseenter', () => { btn.style.background = '#F5C6C3'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = C.errorContainer; });
    return btn;
  }

  // Helpers

  function makeDraggable(panel) {
    let isDragging = false, offsetX, offsetY;
    panel.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') return;
      isDragging = true;
      offsetX = e.clientX - panel.getBoundingClientRect().left;
      offsetY = e.clientY - panel.getBoundingClientRect().top;
      panel.style.transition = 'none';
    });
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      panel.style.left  = (e.clientX - offsetX) + 'px';
      panel.style.top   = (e.clientY - offsetY) + 'px';
      panel.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => { isDragging = false; });
  }

  function removeElement(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }

  function removeExisting() {
    removeElement('sct-overlay');
    removeElement('sct-processing');
    removeElement('sct-results');
    removeElement('sct-history-panel');
  }

  function formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
      ' \u00b7 ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

})();
