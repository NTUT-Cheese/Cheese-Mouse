// ============================================================
// Cheese Mouse — 共用型別定義
// DOM 特徵萃取與訊息傳遞介面
// ============================================================

import type { SemanticData, BehavioralData } from '@/analyzers/types';

/**
 * 單一 DOM 元素的結構化特徵
 * 由特徵萃取器從原始 DOM 壓縮而來
 */
export interface ElementFeature {
  /** 標籤名稱 (小寫, e.g. 'input', 'a', 'form') */
  tag: string;
  /** 元素 id 屬性 */
  id?: string;
  /** CSS class 列表 */
  classes?: string[];
  /** input type 屬性 */
  type?: string;
  /** 元素 name 屬性 */
  name?: string;
  /** 連結 href 或 form action */
  href?: string;
  /** form action URL */
  action?: string;
  /** form method (GET/POST) */
  method?: string;
  /** 資源來源 (iframe src, script src) */
  src?: string;
  /** autocomplete 屬性值 */
  autocomplete?: string;
  /** placeholder 文字 */
  placeholder?: string;
  /** sandbox 屬性 (iframe) */
  sandbox?: string;
  /** 連結 target 屬性 */
  target?: string;
  /** form 內含的 input 數量 */
  inputCount?: number;
  /** inline script 長度 (字元數) */
  inlineLength?: number;
  /** 是否為隱藏元素 (display:none, visibility:hidden, 零尺寸等) */
  isHidden: boolean;
  /** 是否為外部連結/資源 (不同 domain) */
  isExternal: boolean;
  /** 是否含有可疑的 inline event handler */
  hasSuspiciousHandler: boolean;
  /** 元素在視窗中的座標位置 */
  position: { x: number; y: number };
  /** 行為標籤 (如 'password-field', 'hidden-iframe', 'external-form') */
  behaviorTags: string[];
}

/**
 * 整頁特徵報告
 * 包含所有敏感元素的萃取特徵與頁面統計摘要
 */
export interface PageFeatureReport {
  /** 當前頁面完整 URL */
  url: string;
  /** 當前頁面 domain */
  domain: string;
  /** 掃描時間戳 (Unix ms) */
  timestamp: number;
  /** 所有敏感元素的結構化特徵 */
  features: ElementFeature[];
  /** 頁面層級統計摘要 */
  meta: PageMeta;
  /** 語意層壓縮結果（Readability 萃取的正文） */
  compressed?: SemanticData;
  /** 行為層分析結果（webRequest 網路請求監控） */
  behavioral?: BehavioralData;
}

/**
 * 頁面統計摘要
 */
export interface PageMeta {
  /** 輸入欄位總數 (input + textarea) */
  totalInputs: number;
  /** 表單總數 */
  totalForms: number;
  /** 外部連結總數 */
  totalExternalLinks: number;
  /** iframe 總數 */
  totalIframes: number;
  /** script 標籤總數 */
  totalScripts: number;
  /** 是否包含密碼欄位 */
  hasPasswordField: boolean;
  /** 是否包含信用卡相關欄位 */
  hasCreditCardField: boolean;
}

// ============================================================
// Content Script ↔ Background Script 訊息型別
// ============================================================

/** Content → Background: 頁面特徵報告 */
export interface PageFeaturesMessage {
  type: 'PAGE_FEATURES';
  payload: PageFeatureReport;
}

/** Sidebar/Background → Content: 請求掃描 */
export interface ScanRequestMessage {
  type: 'SCAN_REQUEST';
}

/** Background → Sidebar: 掃描結果 (後續迭代使用) */
export interface ScanResultMessage {
  type: 'SCAN_RESULT';
  payload: {
    score: number;
    url: string;
    timestamp: number;
  };
}

/** Sidebar → Background: 請求最新報告 */
export interface GetLatestReportMessage {
  type: 'GET_LATEST_REPORT';
}

/** Background → Sidebar: 活躍 Tab 已切換或更新 */
export interface TabChangedMessage {
  type: 'TAB_CHANGED';
  payload: {
    tabId: number;
    url?: string;
  };
}

/** 所有訊息的聯合型別 */
export type ExtensionMessage =
  | PageFeaturesMessage
  | ScanRequestMessage
  | ScanResultMessage
  | GetLatestReportMessage
  | TabChangedMessage;
