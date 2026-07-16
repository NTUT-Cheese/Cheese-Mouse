// ============================================================
// Cheese Mouse — DOM 層分析器 (DOM Layer)
// 重新匯出現有的 extractor 模組，包裝為 LayerResult 格式
// ============================================================

import { extractPageFeatures, extractFeaturesFromSubtree } from '@/utils/extractor';
import type { LayerResult } from '../types';
import type { PageFeatureReport } from '@/utils/types';

// 重新匯出，方便其他模組直接從 analyzers/dom 引用
export { extractPageFeatures, extractFeaturesFromSubtree };

/**
 * DOM 層分析：萃取所有敏感元素的結構化特徵
 *
 * 包裝現有 extractPageFeatures() 為統一的 LayerResult 格式，
 * 方便與其他分析層聚合。
 *
 * ⚠️ 必須在 content script 中呼叫（需要存取 document）
 */
export function analyzeDomLayer(): LayerResult<PageFeatureReport> {
  const start = performance.now();

  try {
    const report = extractPageFeatures();
    const durationMs = Math.round(performance.now() - start);

    return {
      layer: 'dom',
      timestamp: Date.now(),
      durationMs,
      success: true,
      data: report,
    };
  } catch (e) {
    const durationMs = Math.round(performance.now() - start);
    const errorMessage = e instanceof Error ? e.message : String(e);

    console.warn('[Cheese Mouse] DOM layer error:', errorMessage);

    return {
      layer: 'dom',
      timestamp: Date.now(),
      durationMs,
      success: false,
      error: errorMessage,
      data: {
        url: window.location.href,
        domain: window.location.hostname,
        timestamp: Date.now(),
        features: [],
        meta: {
          totalInputs: 0,
          totalForms: 0,
          totalExternalLinks: 0,
          totalIframes: 0,
          totalScripts: 0,
          hasPasswordField: false,
          hasCreditCardField: false,
        },
      },
    };
  }
}
