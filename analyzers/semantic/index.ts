// ============================================================
// Cheese Mouse — 語意層分析器 (Semantic Layer)
// 使用 @mozilla/readability 萃取頁面核心正文
// ============================================================

import { Readability } from '@mozilla/readability';
import type { LayerResult, SemanticData } from '../types';

// ----------------------------------------------------------
// 常數
// ----------------------------------------------------------

/** 純文字截斷上限（字元數），約 1.5K tokens，適合 0.5B 模型 */
const MAX_TEXT_LENGTH = 3000;

// ----------------------------------------------------------
// 工具函式
// ----------------------------------------------------------

/**
 * 移除 HTML 標籤，保留純文字
 * 也移除多餘的空白與換行
 */
export function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')         // 移除 HTML 標籤
    .replace(/&nbsp;/gi, ' ')        // 替換 &nbsp;
    .replace(/&amp;/gi, '&')         // 替換 &amp;
    .replace(/&lt;/gi, '<')          // 替換 &lt;
    .replace(/&gt;/gi, '>')          // 替換 &gt;
    .replace(/&quot;/gi, '"')        // 替換 &quot;
    .replace(/&#39;/gi, "'")         // 替換 &#39;
    .replace(/\s+/g, ' ')           // 合併連續空白
    .trim();
}

/**
 * 智慧截斷文字
 * 儘量在句子邊界截斷，避免切在單字中間
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  // 在 maxLength 附近尋找句子結尾 (。！？.!?)
  const searchRange = text.substring(0, maxLength);

  // 從後往前找最近的句子結尾
  const sentenceEnders = /[。！？.!?\n]/g;
  let lastEnd = -1;
  let match: RegExpExecArray | null;

  while ((match = sentenceEnders.exec(searchRange)) !== null) {
    lastEnd = match.index + 1;
  }

  // 如果找到句子結尾且距離不太遠（至少保留 70% 內容），就在那裡截斷
  if (lastEnd > maxLength * 0.7) {
    return text.substring(0, lastEnd).trim() + '…';
  }

  // 否則在空格處截斷
  const lastSpace = searchRange.lastIndexOf(' ');
  if (lastSpace > maxLength * 0.7) {
    return text.substring(0, lastSpace).trim() + '…';
  }

  // 最後手段：硬截斷
  return text.substring(0, maxLength).trim() + '…';
}

// ----------------------------------------------------------
// 核心分析函式
// ----------------------------------------------------------

/**
 * 語意層分析：萃取頁面核心正文
 *
 * 使用 Mozilla Readability 剝離導航列、廣告、側欄等非正文元素，
 * 保留核心文章內容並壓縮為純文字。
 *
 * ⚠️ 必須在 content script 中呼叫（需要存取 document）
 * ⚠️ Readability 會修改傳入的 DOM，所以使用 document.cloneNode(true)
 */
export function analyzeSemanticLayer(): LayerResult<SemanticData> {
  const start = performance.now();
  const originalLength = document.documentElement.innerHTML.length;

  try {
    // Clone DOM — Readability.parse() 會修改傳入的 document
    const clone = document.cloneNode(true) as Document;
    const reader = new Readability(clone);
    const article = reader.parse();

    const durationMs = Math.round(performance.now() - start);

    if (!article) {
      // Readability 無法解析（例如：登入頁面、搜尋結果頁等非文章型頁面）
      // Fallback: 使用 document.title + meta description
      const fallbackText = buildFallbackText();

      return {
        layer: 'semantic',
        timestamp: Date.now(),
        durationMs,
        success: true,
        data: {
          title: document.title || null,
          byline: null,
          siteName: null,
          excerpt: getMetaDescription(),
          textContent: truncateText(fallbackText, MAX_TEXT_LENGTH),
          fullTextLength: fallbackText.length,
          originalDomLength: originalLength,
          compressionRatio: fallbackText.length / Math.max(originalLength, 1),
          isParseable: false,
          lang: document.documentElement.lang || null,
        },
      };
    }

    // Readability 成功解析
    // article.textContent 是已經去標籤的純文字（Readability 內建）
    // 但我們也提供 stripHtmlTags 作為備用處理
    const fullText = article.textContent
      ? article.textContent.replace(/\s+/g, ' ').trim()
      : stripHtmlTags(article.content || '');

    const truncated = truncateText(fullText, MAX_TEXT_LENGTH);

    return {
      layer: 'semantic',
      timestamp: Date.now(),
      durationMs,
      success: true,
      data: {
        title: article.title || null,
        byline: article.byline || null,
        siteName: article.siteName || null,
        excerpt: article.excerpt || null,
        textContent: truncated,
        fullTextLength: fullText.length,
        originalDomLength: originalLength,
        compressionRatio: fullText.length / Math.max(originalLength, 1),
        isParseable: true,
        lang: article.lang || document.documentElement.lang || null,
      },
    };
  } catch (e) {
    const durationMs = Math.round(performance.now() - start);
    const errorMessage = e instanceof Error ? e.message : String(e);

    console.warn('[Cheese Mouse] Semantic layer error:', errorMessage);

    return {
      layer: 'semantic',
      timestamp: Date.now(),
      durationMs,
      success: false,
      error: errorMessage,
      data: {
        title: document.title || null,
        byline: null,
        siteName: null,
        excerpt: null,
        textContent: '',
        fullTextLength: 0,
        originalDomLength: originalLength,
        compressionRatio: 1,
        isParseable: false,
        lang: null,
      },
    };
  }
}

// ----------------------------------------------------------
// 輔助函式
// ----------------------------------------------------------

/**
 * 取得 meta description 內容
 */
function getMetaDescription(): string | null {
  const meta = document.querySelector('meta[name="description"]');
  return meta?.getAttribute('content') || null;
}

/**
 * 建構 Fallback 文字
 * 當 Readability 無法解析時，從 title + meta description + body 文字拼湊
 */
function buildFallbackText(): string {
  const parts: string[] = [];

  // Title
  if (document.title) {
    parts.push(document.title);
  }

  // Meta description
  const desc = getMetaDescription();
  if (desc) {
    parts.push(desc);
  }

  // Body innerText 的前 5000 字元（作為 raw fallback）
  try {
    const bodyText = document.body?.innerText || '';
    if (bodyText) {
      parts.push(bodyText.substring(0, 5000));
    }
  } catch {
    // 某些頁面可能無法存取 body
  }

  return parts.join('\n\n').replace(/\s+/g, ' ').trim();
}
