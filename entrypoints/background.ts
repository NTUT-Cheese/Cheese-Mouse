// ============================================================
// Cheese Mouse — Background Script
// 訊息路由與集中處理
// ============================================================

import type { ExtensionMessage, PageFeatureReport } from '@/utils/types';
import { BehavioralAnalyzer } from '@/analyzers/behavioral';

/** 最新的頁面特徵報告快取 (tabId → report) */
const latestReports = new Map<number, PageFeatureReport>();

/** 行為層分析器（全域單例） */
const behavioralAnalyzer = new BehavioralAnalyzer();

/**
 * 處理來自 Content Script 的頁面特徵報告
 * 目前僅 log 輸出，後續迭代接上快取比對 → AI 推論
 */
function handlePageFeatures(report: PageFeatureReport, tabId?: number): void {
  console.log('[Cheese Mouse] 📊 Received page features:', {
    url: report.url,
    domain: report.domain,
    timestamp: new Date(report.timestamp).toLocaleTimeString(),
    elementCount: report.features.length,
    meta: report.meta,
  });

  // 附加行為層資料
  if (tabId != null) {
    const behavioralResult = behavioralAnalyzer.getReport(tabId);
    report.behavioral = behavioralResult.data;

    if (behavioralResult.data.suspiciousEvents.length > 0) {
      console.warn(
        '[Cheese Mouse] ⚡ Behavioral alerts:',
        behavioralResult.data.suspiciousEvents,
      );
    }

    console.log('[Cheese Mouse] ⚡ Behavioral layer:', {
      externalRequests: behavioralResult.data.externalRequests.total,
      topDomains: Object.entries(behavioralResult.data.externalRequests.byDomain)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([domain, count]) => `${domain}(${count})`),
      suspiciousEvents: behavioralResult.data.suspiciousEvents.length,
      took: `${behavioralResult.durationMs}ms`,
    });
  }

  // 快取最新報告
  if (tabId != null) {
    latestReports.set(tabId, report);
  }

  // 廣播給可能開啟的 Sidebar
  browser.runtime.sendMessage({
    type: 'PAGE_FEATURES',
    payload: report,
  }).catch(() => {
    // 沒有 sidebar 監聯時會報錯，直接忽略
  });

  // 列出高風險行為標籤
  const riskyFeatures = report.features.filter(
    (f) => f.behaviorTags.length > 0
  );

  if (riskyFeatures.length > 0) {
    console.log('[Cheese Mouse] ⚠️ Elements with behavior tags:', riskyFeatures.length);
    for (const f of riskyFeatures) {
      console.log(
        `  ${f.tag}${f.id ? '#' + f.id : ''}${f.name ? '[name="' + f.name + '"]' : ''} → [${f.behaviorTags.join(', ')}]`
      );
    }
  }

  // TODO: 送往本地特徵快取比對
  // TODO: 未命中時送往 WebLLM 推論
}

export default defineBackground(() => {
  console.log('[Cheese Mouse] Background script loaded:', { id: browser.runtime.id });

  // 啟動行為層分析器（webRequest 監控）
  behavioralAnalyzer.start();

  // 點擊擴充功能圖示 → 切換 sidebar
  browser.browserAction.onClicked.addListener(() => {
    if ('sidebarAction' in browser) {
      (browser as any).sidebarAction.toggle();
    }
  });

  // 監聽來自 Content Script / Sidebar 的訊息
  browser.runtime.onMessage.addListener(
    (message: ExtensionMessage, sender) => {
      switch (message.type) {
        case 'PAGE_FEATURES':
          handlePageFeatures(message.payload, sender.tab?.id);
          break;

        case 'GET_LATEST_REPORT': {
          // Sidebar 請求最新報告
          return (async () => {
            const tabs = await browser.tabs.query({ active: true, currentWindow: true });
            const tabId = tabs[0]?.id;
            if (tabId != null && latestReports.has(tabId)) {
              return latestReports.get(tabId);
            }
            return null;
          })();
        }

        case 'SCAN_REQUEST': {
          // Sidebar 請求主動掃描 → 轉發到 content script
          return (async () => {
            const tabs = await browser.tabs.query({ active: true, currentWindow: true });
            const tabId = tabs[0]?.id;
            if (tabId != null) {
              await browser.tabs.sendMessage(tabId, { type: 'SCAN_REQUEST' }).catch((err) => {
                console.debug('[Cheese Mouse] Cannot send SCAN_REQUEST to tab:', tabId, err);
              });
            }
          })();
        }

        default:
          console.debug('[Cheese Mouse] Unknown message type:', message);
      }
    }
  );

  // 監聽活躍 Tab 切換
  browser.tabs.onActivated.addListener((activeInfo) => {
    browser.runtime.sendMessage({
      type: 'TAB_CHANGED',
      payload: { tabId: activeInfo.tabId },
    }).catch(() => {});
  });

  // 監聽 Tab 狀態更新 (如重新載入、網址改變)
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // 頁面導航時重置行為層記錄
    if (changeInfo.status === 'loading') {
      behavioralAnalyzer.resetTab(tabId);
    }

    // 當頁面載入完成且是 http/https 頁面時，自動觸發掃描
    if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
      console.log('[Cheese Mouse] Tab updated and complete, requesting scan for tab:', tabId);
      browser.tabs.sendMessage(tabId, { type: 'SCAN_REQUEST' }).catch(() => {
        // Content script 可能尚未準備好，忽略
      });

      // 同時通知 sidebar
      browser.runtime.sendMessage({
        type: 'TAB_CHANGED',
        payload: { tabId, url: tab.url },
      }).catch(() => {});
    }
  });

  // 清除已關閉 tab 的快取
  browser.tabs.onRemoved.addListener((tabId) => {
    latestReports.delete(tabId);
  });
});
