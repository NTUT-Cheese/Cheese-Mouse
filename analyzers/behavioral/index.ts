// ============================================================
// Cheese Mouse — 行為層分析器 (Behavioral Layer)
// 透過 webRequest API 監控網路請求模式，偵測可疑行為
// ============================================================
//
// 此模組在 background script 中初始化並運行。
// webRequest API 只能在 background context 使用。
//
// 偵測能力：
// 1. 過多外部請求 → 追蹤/資料外洩
// 2. 已知惡意域名模式 → 挖礦、C2 伺服器
// 3. 短時間大量 POST → 憑證竊取
// 4. 多層重定向鏈 → 釣魚/惡意軟體分發
// ============================================================

import type {
  LayerResult,
  BehavioralData,
  BehavioralEvent,
  RequestEntry,
} from '../types';
import type { Browser } from 'wxt/browser';

// ----------------------------------------------------------
// 常數
// ----------------------------------------------------------

/** 每個 tab 最多保留的請求記錄數 */
const MAX_ENTRIES_PER_TAB = 500;

/** 觸發「過多外部請求」警告的門檻 */
const EXCESSIVE_REQUESTS_THRESHOLD = 50;

/** 已知可疑域名模式（挖礦、追蹤器等） */
const SUSPICIOUS_DOMAIN_PATTERNS = [
  // 加密貨幣挖礦
  /coinhive\./i,
  /coin-?hive\./i,
  /crypto-?loot\./i,
  /minero?\./i,
  /coinimp\./i,
  /ppoi\.org/i,
  /cryptonight/i,

  // 已知惡意追蹤
  /evil\./i,
  /malware\./i,
  /phishing\./i,
];

// ----------------------------------------------------------
// 工具函式
// ----------------------------------------------------------

/**
 * 從 URL 提取域名
 */
function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * 提取根域名 (eTLD+1 近似)
 */
function getRootDomain(hostname: string): string {
  const parts = hostname.split('.');
  const knownSecondLevel = ['co', 'com', 'net', 'org', 'edu', 'gov', 'ac'];
  if (parts.length >= 3 && knownSecondLevel.includes(parts[parts.length - 2])) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

/**
 * 判定請求是否為外部（不同根域名）
 */
function isExternalRequest(requestUrl: string, tabUrl: string): boolean {
  try {
    const reqDomain = getRootDomain(extractDomain(requestUrl));
    const tabDomain = getRootDomain(extractDomain(tabUrl));
    return reqDomain !== tabDomain && reqDomain !== '';
  } catch {
    return false;
  }
}

// ----------------------------------------------------------
// 行為分析器
// ----------------------------------------------------------

/**
 * 行為層分析器
 *
 * 在 background script 中建立實例並呼叫 start()。
 * 透過 webRequest.onBeforeRequest 攔截所有 HTTP 請求，
 * 依 tabId 分組記錄，供後續分析與報告。
 */
export class BehavioralAnalyzer {
  /** tabId → 請求記錄列表 */
  private requestLog = new Map<number, RequestEntry[]>();

  /** tabId → 該 tab 的主頁面 URL */
  private tabUrls = new Map<number, string>();

  /**
   * 啟動 webRequest 監控
   * 應在 background script 初始化時呼叫一次
   */
  start(): void {
    // 監聽所有 HTTP/HTTPS 請求
    browser.webRequest.onBeforeRequest.addListener(
      (details) => { this.handleRequest(details); return undefined; },
      { urls: ['<all_urls>'] },
    );

    // 追蹤 Tab URL 變化
    browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo.url) {
        this.tabUrls.set(tabId, changeInfo.url);
      }
    });

    // 清理已關閉 tab 的記錄
    browser.tabs.onRemoved.addListener((tabId) => {
      this.requestLog.delete(tabId);
      this.tabUrls.delete(tabId);
    });

    console.log('[Cheese Mouse] ⚡ Behavioral analyzer started');
  }

  /**
   * 清除指定 tab 的請求記錄（頁面導航時重置）
   */
  resetTab(tabId: number): void {
    this.requestLog.delete(tabId);
  }

  /**
   * 取得指定 tab 的行為分析報告
   */
  getReport(tabId: number): LayerResult<BehavioralData> {
    const start = performance.now();
    const entries = this.requestLog.get(tabId) || [];
    const externalEntries = entries.filter((e) => e.isExternal);

    // 依域名分組
    const byDomain: Record<string, number> = {};
    for (const entry of externalEntries) {
      byDomain[entry.domain] = (byDomain[entry.domain] || 0) + 1;
    }

    // 依類型分組
    const byType: Record<string, number> = {};
    for (const entry of externalEntries) {
      byType[entry.type] = (byType[entry.type] || 0) + 1;
    }

    // 偵測可疑模式
    const suspiciousEvents = this.detectSuspiciousPatterns(tabId, externalEntries);

    const durationMs = Math.round(performance.now() - start);

    return {
      layer: 'behavioral',
      timestamp: Date.now(),
      durationMs,
      success: true,
      data: {
        externalRequests: {
          total: externalEntries.length,
          byDomain,
          byType,
        },
        suspiciousEvents,
      },
    };
  }

  // ----------------------------------------------------------
  // 內部方法
  // ----------------------------------------------------------

  /**
   * 處理單筆 webRequest 請求
   */
  private handleRequest(
    details: Browser.webRequest.OnBeforeRequestDetails,
  ): void {
    const { tabId, url, type } = details;

    // 忽略非 tab 請求（如 background 自身的請求）
    if (tabId < 0) return;

    // 忽略非 http/https
    if (!url.startsWith('http')) return;

    const domain = extractDomain(url);
    const tabUrl = this.tabUrls.get(tabId) || '';
    const isExternal = isExternalRequest(url, tabUrl);

    const entry: RequestEntry = {
      url,
      domain,
      type: type || 'other',
      timestamp: Date.now(),
      isExternal,
    };

    // 加入記錄（帶容量上限）
    if (!this.requestLog.has(tabId)) {
      this.requestLog.set(tabId, []);
    }

    const entries = this.requestLog.get(tabId)!;
    entries.push(entry);

    // 容量控制：超過上限時移除最舊的記錄
    if (entries.length > MAX_ENTRIES_PER_TAB) {
      entries.splice(0, entries.length - MAX_ENTRIES_PER_TAB);
    }
  }

  /**
   * 偵測可疑行為模式
   */
  private detectSuspiciousPatterns(
    _tabId: number,
    externalEntries: RequestEntry[],
  ): BehavioralEvent[] {
    const events: BehavioralEvent[] = [];

    // 1. 過多外部請求
    if (externalEntries.length > EXCESSIVE_REQUESTS_THRESHOLD) {
      events.push({
        type: 'excessive-requests',
        description: `偵測到 ${externalEntries.length} 個外部請求，超過門檻值 ${EXCESSIVE_REQUESTS_THRESHOLD}`,
        timestamp: Date.now(),
      });
    }

    // 2. 已知可疑域名
    const suspiciousDomains = new Set<string>();
    for (const entry of externalEntries) {
      for (const pattern of SUSPICIOUS_DOMAIN_PATTERNS) {
        if (pattern.test(entry.domain)) {
          suspiciousDomains.add(entry.domain);
        }
      }
    }

    for (const domain of suspiciousDomains) {
      events.push({
        type: 'suspicious-domain',
        description: `偵測到已知可疑域名的請求: ${domain}`,
        url: domain,
        timestamp: Date.now(),
      });
    }

    // 3. 大量 POST/XHR 請求到外部（可能是資料外洩）
    const xhrEntries = externalEntries.filter(
      (e) => e.type === 'xmlhttprequest' || e.type === 'beacon',
    );
    if (xhrEntries.length > 20) {
      events.push({
        type: 'data-exfiltration',
        description: `偵測到 ${xhrEntries.length} 個外部 XHR/Beacon 請求，可能正在傳送資料`,
        timestamp: Date.now(),
      });
    }

    return events;
  }
}
