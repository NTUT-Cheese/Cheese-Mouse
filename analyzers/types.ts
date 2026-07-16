// ============================================================
// Cheese Mouse — 多層分析管線：共用型別定義
// 視覺層 / 語意層 / DOM 層 / 行為層
// ============================================================

import type { PageFeatureReport } from '@/utils/types';

// ----------------------------------------------------------
// 通用信封
// ----------------------------------------------------------

/** 各分析層的通用回傳信封 */
export interface LayerResult<T> {
  /** 分析層標識 */
  layer: 'visual' | 'semantic' | 'dom' | 'behavioral';
  /** 分析完成時間戳 (Unix ms) */
  timestamp: number;
  /** 該層分析耗時 (ms) */
  durationMs: number;
  /** 是否成功完成分析 */
  success: boolean;
  /** 失敗時的錯誤訊息 */
  error?: string;
  /** 分析結果資料 */
  data: T;
}

// ----------------------------------------------------------
// 📖 語意層 (Semantic Layer)
// ----------------------------------------------------------

/** 語意層輸出 — Readability 萃取的正文結構 */
export interface SemanticData {
  /** Readability 萃取的文章標題 */
  title: string | null;
  /** Readability 萃取的作者 */
  byline: string | null;
  /** Readability 萃取的網站名稱 */
  siteName: string | null;
  /** Readability 萃取的摘要文字 */
  excerpt: string | null;
  /** 去標籤後的純正文文字（已截斷） */
  textContent: string;
  /** 正文字元數（截斷前） */
  fullTextLength: number;
  /** 原始 DOM innerHTML 的大約長度 */
  originalDomLength: number;
  /** 壓縮率 (0~1)，越小越有效 */
  compressionRatio: number;
  /** Readability 是否成功解析（某些頁面可能失敗） */
  isParseable: boolean;
  /** 偵測到的頁面語言 */
  lang: string | null;
}

// ----------------------------------------------------------
// 👁️ 視覺層 (Visual Layer)
// ----------------------------------------------------------

/** 視覺層輸出（骨架，待後續實作） */
export interface VisualData {
  /** base64 截圖 data URL（未來用） */
  screenshotDataUrl: string | null;
  /** 頁面主色調 (hex) */
  dominantColors: string[];
  /** 視覺上是否偵測到登入表單 */
  hasLoginForm: boolean;
  /** 是否偵測到品牌 logo */
  logoDetected: boolean;
  // 未來擴充：
  // visualFingerprint: string;     // 視覺指紋 hash
  // brandSimilarity: number;       // 與已知品牌的相似度分數 (0~1)
}

// ----------------------------------------------------------
// ⚡ 行為層 (Behavioral Layer)
// ----------------------------------------------------------

/** 行為層輸出 — 網路請求模式與可疑行為事件 */
export interface BehavioralData {
  /** 外部網路請求統計 */
  externalRequests: {
    /** 外部請求總數 */
    total: number;
    /** 依域名分組的請求數 (domain → count) */
    byDomain: Record<string, number>;
    /** 依資源類型分組的請求數 (script/image/xhr/... → count) */
    byType: Record<string, number>;
  };
  /** 偵測到的可疑行為事件 */
  suspiciousEvents: BehavioralEvent[];
}

/** 單一可疑行為事件 */
export interface BehavioralEvent {
  /** 事件類別 */
  type:
    | 'data-exfiltration'
    | 'crypto-mining'
    | 'redirect-chain'
    | 'credential-harvest'
    | 'excessive-requests'
    | 'suspicious-domain';
  /** 事件描述 */
  description: string;
  /** 相關 URL */
  url?: string;
  /** 事件時間 */
  timestamp: number;
}

/** webRequest 記錄的單筆請求條目 (內部使用) */
export interface RequestEntry {
  /** 請求 URL */
  url: string;
  /** 請求目標域名 */
  domain: string;
  /** 資源類型 (script, image, xmlhttprequest, etc.) */
  type: string;
  /** 請求時間 */
  timestamp: number;
  /** 是否為外部請求（不同根域名） */
  isExternal: boolean;
}

// ----------------------------------------------------------
// 多層聚合報告
// ----------------------------------------------------------

/**
 * 多層聚合報告
 * 匯集所有分析層的結果，最終送往 AI 引擎或 Sidebar 展示
 */
export interface MultiLayerReport {
  /** 當前頁面完整 URL */
  url: string;
  /** 當前頁面 domain */
  domain: string;
  /** 報告產出時間 */
  timestamp: number;
  /** 各分析層結果 */
  layers: {
    visual?: LayerResult<VisualData>;
    semantic?: LayerResult<SemanticData>;
    dom: LayerResult<PageFeatureReport>;
    behavioral?: LayerResult<BehavioralData>;
  };
}
