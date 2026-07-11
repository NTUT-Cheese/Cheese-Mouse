// ============================================================
// Cheese Mouse — Content Script
// DOM 即時監控與特徵萃取觸發器
// ============================================================

import { extractPageFeatures, extractFeaturesFromSubtree } from '@/utils/extractor';
import type { PageFeaturesMessage, ExtensionMessage } from '@/utils/types';

/** 防抖計時器 ID */
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** 防抖延遲 (ms) — DOM 更新停止後 300ms 執行掃描，即時且高效 */
const DEBOUNCE_DELAY = 300;

/** MutationObserver 觸發的最小新增敏感節點數閾值 */
const MUTATION_THRESHOLD = 1;

/**
 * 執行全頁掃描，將特徵報告送往 background script
 */
function performFullScan(): void {
  const report = extractPageFeatures();

  const message: PageFeaturesMessage = {
    type: 'PAGE_FEATURES',
    payload: report,
  };

  browser.runtime.sendMessage(message).catch((err) => {
    // 擴充功能 context invalidated 時可能失敗，靜默處理
    console.debug('[Cheese Mouse] Failed to send features:', err);
  });

  console.log(
    `[Cheese Mouse] Page scan complete: ${report.features.length} elements, ` +
    `${report.meta.totalForms} forms, ` +
    `${report.meta.totalInputs} inputs, ` +
    `password: ${report.meta.hasPasswordField}, ` +
    `credit-card: ${report.meta.hasCreditCardField}`
  );
}

/**
 * 防抖版全頁掃描
 * 在快速連續觸發時只執行最後一次
 */
function debouncedFullScan(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    performFullScan();
    debounceTimer = null;
  }, DEBOUNCE_DELAY);
}

/**
 * 設置 MutationObserver 監控 DOM 動態變化
 * 偵測新增的敏感元素時觸發重新掃描
 */
function setupMutationObserver(): MutationObserver {
  const observer = new MutationObserver((mutations) => {
    let sensitiveChanges = 0;

    for (const mutation of mutations) {
      // 檢查新增節點
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const el = node as Element;

        // 檢查節點本身及子樹是否包含敏感元素
        const features = extractFeaturesFromSubtree(el);
        sensitiveChanges += features.length;
      }

      // 屬性變化也可能影響特徵 (如 type, href 等)
      if (mutation.type === 'attributes' && mutation.target.nodeType === Node.ELEMENT_NODE) {
        const attr = mutation.attributeName;
        if (attr && ['type', 'href', 'action', 'src', 'name', 'style', 'class'].includes(attr)) {
          sensitiveChanges++;
        }
      }
    }

    // 超過閾值時觸發重新掃描
    if (sensitiveChanges >= MUTATION_THRESHOLD) {
      console.debug(`[Cheese Mouse] DOM mutation detected: ${sensitiveChanges} sensitive changes`);
      debouncedFullScan();
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['type', 'href', 'action', 'src', 'name', 'style', 'class', 'hidden'],
  });

  return observer;
}

/**
 * 設置敏感事件的捕獲階段監聽
 * focus/submit 觸發時即時更新特徵
 */
function setupEventListeners(): void {
  // focus 事件 — 使用者聚焦到輸入欄位時
  document.addEventListener(
    'focus',
    (event) => {
      const target = event.target as Element;
      if (!target?.tagName) return;

      const tag = target.tagName.toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag)) {
        console.debug(`[Cheese Mouse] Sensitive focus: ${tag}[name="${target.getAttribute('name')}"]`);
        debouncedFullScan();
      }
    },
    true // 捕獲階段
  );

  // submit 事件 — 表單提交時
  document.addEventListener(
    'submit',
    (event) => {
      const form = event.target as HTMLFormElement;
      if (!form?.tagName) return;

      console.debug(`[Cheese Mouse] Form submit: action="${form.action}"`);
      // 表單提交是高敏感操作，立即掃描不防抖
      performFullScan();
    },
    true // 捕獲階段
  );
}

/**
 * 監聽來自 background/sidebar 的掃描請求
 */
function setupMessageListener(): void {
  browser.runtime.onMessage.addListener((message: ExtensionMessage) => {
    if (message.type === 'SCAN_REQUEST') {
      console.log('[Cheese Mouse] Scan requested by background/sidebar');
      performFullScan();
    }
  });

  // 監聽頁面可見度變化 (當使用者切換回此分頁時自動重新掃描)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      console.debug('[Cheese Mouse] Page became visible, triggering scan');
      performFullScan();
    }
  });
}

// ============================================================
// Content Script 入口
// ============================================================

export default defineContentScript({
  matches: ['<all_urls>'],

  main() {
    console.log('[Cheese Mouse] Content script loaded:', window.location.href);

    // 1. 頁面載入完成後執行首次全頁掃描
    if (document.readyState === 'complete') {
      performFullScan();
    } else {
      window.addEventListener('load', () => {
        performFullScan();
      });
    }

    // 2. 啟動 MutationObserver 監控 DOM 動態變化
    setupMutationObserver();

    // 3. 設置敏感事件監聽
    setupEventListeners();

    // 4. 監聽來自 background/sidebar 的訊息
    setupMessageListener();
  },
});
