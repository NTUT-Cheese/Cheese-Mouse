// ============================================================
// Cheese Mouse — 視覺層分析器 (Visual Layer)
// 骨架模組，待後續搭配 AI 模型實作
// ============================================================
//
// 未來規劃：
// 1. 透過 browser.tabs.captureVisibleTab() 擷取頁面截圖
// 2. 提取視覺特徵（主色調、版面佈局、logo 位置）
// 3. 與已知品牌頁面做視覺相似度比對
// 4. 偵測釣魚網站的外觀仿冒行為
//
// 此層需要在 background script 中呼叫 captureVisibleTab()，
// 然後將截圖資料傳送給 AI 引擎進行多模態分析。
// ============================================================

import type { LayerResult, VisualData } from '../types';

/**
 * 視覺層分析（骨架）
 *
 * 目前回傳未實作狀態，待 AI 引擎（階段四）就緒後再啟用。
 * 需要 AI 模型才能進行有意義的視覺比對分析。
 */
export function analyzeVisualLayer(): LayerResult<VisualData> {
  return {
    layer: 'visual',
    timestamp: Date.now(),
    durationMs: 0,
    success: false,
    error: 'Visual layer not implemented yet — requires AI engine',
    data: {
      screenshotDataUrl: null,
      dominantColors: [],
      hasLoginForm: false,
      logoDetected: false,
    },
  };
}

/**
 * 擷取當前分頁的截圖（在 background script 中呼叫）
 *
 * 未來實作時使用：
 * ```typescript
 * const dataUrl = await browser.tabs.captureVisibleTab(undefined, {
 *   format: 'png',
 *   quality: 80,
 * });
 * ```
 */
export async function captureScreenshot(): Promise<string | null> {
  // TODO: 實作截圖擷取
  // 需要在 background script 中呼叫 browser.tabs.captureVisibleTab()
  return null;
}
