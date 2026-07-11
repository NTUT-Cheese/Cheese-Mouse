// ============================================================
// Cheese Mouse — 結構化特徵萃取引擎
// 純函式設計，將 DOM 壓縮為輕量結構化特徵
// ============================================================

import type { ElementFeature, PageFeatureReport, PageMeta } from './types';

// ----------------------------------------------------------
// 常數定義
// ----------------------------------------------------------

/** 需要萃取特徵的敏感元素選擇器 */
const SENSITIVE_SELECTORS = [
  'input',
  'textarea',
  'select',
  'button',
  'a[href]',
  'form',
  'iframe',
  'script',
].join(', ');

/** 可疑的 inline event handler 屬性名稱 */
const SUSPICIOUS_HANDLERS = [
  'onclick',
  'onsubmit',
  'onload',
  'onerror',
  'onmouseover',
  'onfocus',
  'onblur',
  'onchange',
  'onkeydown',
  'onkeyup',
  'onkeypress',
];

/** 可疑的 JavaScript 模式 (用於 inline script 偵測) */
const SUSPICIOUS_PATTERNS = [
  // 動態代碼執行與危險寫入
  /\beval\s*\(/i,
  /\bdocument\.write\s*\(/i,
  /\bdocument\.writeln\s*\(/i,
  /\bnew\s+Function\s*\(/i,
  
  // 傳入字串的定時器 (等同 eval)
  /\bsetTimeout\s*\(\s*['"`]/i,
  /\bsetInterval\s*\(\s*['"`]/i,
  
  // 可疑的 iframe 注入
  /data:text\/html/i,
];

/** 信用卡相關欄位的名稱/autocomplete 模式 */
const CREDIT_CARD_PATTERNS = [
  /card/i,
  /cc[-_]?(num|number|no)/i,
  /credit/i,
  /cvv/i,
  /cvc/i,
  /expir/i,
  /ccv/i,
];

/**
 * 導航/UI 上下文選擇器
 * 這些容器內的隱藏元素和外部連結屬於正常 UI 模式，不應被標記為可疑
 */
const NAVIGATION_CONTEXT_SELECTORS = [
  'nav',
  'header',
  'footer',
  '[role="navigation"]',
  '[role="menu"]',
  '[role="menubar"]',
  '[role="tablist"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  'details',
  '.nav',
  '.navbar',
  '.menu',
  '.sidebar',
  '.breadcrumb',
  '.pagination',
  '.dropdown',
  '.toc',              // table of contents (Wikipedia 等)
  '.mw-parser-output', // MediaWiki 內容區 (Wikipedia)
];

// ----------------------------------------------------------
// 工具函式
// ----------------------------------------------------------

/**
 * 提取 URL 的根域名 (eTLD+1 近似)
 * 例如: 'en.wikipedia.org' → 'wikipedia.org'
 *       'www.threads.net' → 'threads.net'
 */
export function getRootDomain(hostname: string): string {
  const parts = hostname.split('.');
  // 處理 co.uk, com.tw 等二級 TLD
  const knownSecondLevel = ['co', 'com', 'net', 'org', 'edu', 'gov', 'ac'];
  if (parts.length >= 3 && knownSecondLevel.includes(parts[parts.length - 2])) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

/**
 * 判定元素是否位於導航/UI 上下文中
 * 這些位置的隱藏元素和連結屬於正常 UI 模式
 */
export function isInNavigationContext(el: Element): boolean {
  const selector = NAVIGATION_CONTEXT_SELECTORS.join(', ');
  return el.closest(selector) !== null;
}

/**
 * 判定元素是否被隱藏
 * 檢查: display:none, visibility:hidden, opacity:0, 零尺寸, type=hidden
 */
export function isHiddenElement(el: Element): boolean {
  // type="hidden" 的 input
  if (el instanceof HTMLInputElement && el.type === 'hidden') {
    return true;
  }

  const style = window.getComputedStyle(el);

  if (style.display === 'none') return true;
  if (style.visibility === 'hidden') return true;
  if (style.opacity === '0') return true;

  // 檢查零尺寸 (排除 script 等本來就不可見的標籤)
  const tag = el.tagName.toLowerCase();
  if (tag !== 'script' && tag !== 'link' && tag !== 'meta') {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return true;
  }

  return false;
}

/**
 * 判定隱藏是否可疑 (而非正常 UI 模式)
 *
 * 正常隱藏: nav 下拉選單、details/summary 收合、RWD 響應式隱藏、
 *           Wikipedia 編輯連結、SPA 框架的虛擬滾動元素
 * 可疑隱藏: 零尺寸 iframe、刻意隱藏的表單、off-screen 定位的 input
 */
export function isSuspiciouslyHidden(el: Element): boolean {
  if (!isHiddenElement(el)) return false;

  const tag = el.tagName.toLowerCase();

  // 導航上下文中的隱藏 → 正常 UI
  if (isInNavigationContext(el)) return false;

  // details/summary 內的隱藏 → 正常 UI
  if (el.closest('details')) return false;

  // aria-hidden 的元素通常是螢幕閱讀器或 UI 裝飾
  if (el.getAttribute('aria-hidden') === 'true') return false;

  // type="hidden" 的 input — 通常是 CSRF token 等正常用途
  // 只有當它在可疑的 form 中才標記
  if (el instanceof HTMLInputElement && el.type === 'hidden') {
    const form = el.closest('form');
    if (form) {
      // 如果 form 提交到外部且不同根域 → 可疑
      const formAction = form.action;
      if (formAction && isStrictlyExternalUrl(formAction)) return true;
    }
    return false;
  }

  // 零尺寸的 iframe → 高度可疑 (用於追蹤/攻擊)
  if (tag === 'iframe') {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 1 && rect.height <= 1) return true;
  }

  // 隱藏的密碼欄位或信用卡欄位 → 可疑
  if (el instanceof HTMLInputElement) {
    if (el.type === 'password') return true;
    const nameOrAuto = `${el.name || ''} ${el.autocomplete || ''}`;
    if (CREDIT_CARD_PATTERNS.some((p) => p.test(nameOrAuto))) return true;
  }

  // 其他一般的隱藏元素 → 不標記為可疑
  return false;
}

/**
 * 判定 URL 是否為外部連結 (寬鬆版: 不同 hostname)
 * 用於統計計數，不影響風險評分
 */
export function isExternalUrl(url: string): boolean {
  if (!url) return false;

  try {
    if (/^(javascript|data|mailto|tel|blob):/i.test(url)) return false;
    const parsed = new URL(url, window.location.href);
    return parsed.hostname !== window.location.hostname;
  } catch {
    return false;
  }
}

/**
 * 判定 URL 是否為嚴格外部連結 (不同根域名)
 * 用於風險評分 — 同站子域名間的連結不計入風險
 * 例如: en.wikipedia.org → fr.wikipedia.org 不算外部
 */
export function isStrictlyExternalUrl(url: string): boolean {
  if (!url) return false;

  try {
    if (/^(javascript|data|mailto|tel|blob):/i.test(url)) return false;
    const parsed = new URL(url, window.location.href);
    return getRootDomain(parsed.hostname) !== getRootDomain(window.location.hostname);
  } catch {
    return false;
  }
}

/**
 * 檢測元素上的可疑 inline event handler
 */
export function hasSuspiciousInlineHandler(el: Element): boolean {
  for (const handler of SUSPICIOUS_HANDLERS) {
    if (el.hasAttribute(handler)) {
      return true;
    }
  }
  return false;
}

/**
 * 偵測 inline script 中的可疑模式
 * @returns 匹配到的模式名稱列表
 */
export function detectSuspiciousPatterns(content: string): string[] {
  const matches: string[] = [];

  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(content)) {
      const label = pattern.source
        .replace(/\\[bsS()]/g, '')
        .replace(/[\[\]\\.*+?^${}|]/g, '')
        .replace(/\s+/g, '')
        .substring(0, 30);
      matches.push(label);
    }
  }

  return matches;
}

/**
 * 為元素產出行為標籤
 * 根據元素類型、屬性、上下文分類其風險行為
 * 區分 informational 標籤 (低風險、純資訊) 與 risk 標籤 (真正可疑)
 */
export function classifyBehavior(el: Element): string[] {
  const tags: string[] = [];
  const tagName = el.tagName.toLowerCase();
  const inNav = isInNavigationContext(el);

  switch (tagName) {
    case 'input':
    case 'textarea': {
      const input = el as HTMLInputElement;
      if (input.type === 'password') tags.push('password-field');
      if (input.type === 'hidden') tags.push('hidden-input');
      if (input.type === 'email') tags.push('email-field');
      if (input.type === 'tel') tags.push('phone-field');

      // 信用卡相關
      const nameOrAuto = `${input.name || ''} ${input.autocomplete || ''}`;
      if (CREDIT_CARD_PATTERNS.some((p) => p.test(nameOrAuto))) {
        tags.push('credit-card-field');
      }
      break;
    }

    case 'a': {
      const anchor = el as HTMLAnchorElement;
      // 只有不同根域名的連結才標記為 external-link (風險標籤)
      // 同站子域名間的連結不標記
      if (isStrictlyExternalUrl(anchor.href)) {
        // 導航上下文中的外部連結 → 降為 info 標籤
        if (inNav) {
          tags.push('nav-external-link');
        } else {
          tags.push('external-link');
        }
      }
      // javascript: href 始終可疑
      if (/^javascript:/i.test(anchor.href || '')) tags.push('javascript-href');
      if (/^data:/i.test(anchor.href || '')) tags.push('data-href');
      // new-window-link 只在非導航上下文中標記
      if (anchor.target === '_blank' && !inNav) tags.push('new-window-link');
      break;
    }

    case 'form': {
      const form = el as HTMLFormElement;
      // 只有提交到不同根域名才標記
      if (isStrictlyExternalUrl(form.action)) tags.push('external-form');
      if (form.method?.toLowerCase() === 'post') tags.push('post-form');
      if (form.querySelectorAll('input[type="password"]').length > 0) {
        tags.push('login-form');
      }
      break;
    }

    case 'iframe': {
      const iframe = el as HTMLIFrameElement;
      if (isStrictlyExternalUrl(iframe.src)) tags.push('external-iframe');
      if (!iframe.sandbox || !iframe.hasAttribute('sandbox')) {
        tags.push('unsandboxed-iframe');
      }
      if (isSuspiciouslyHidden(el)) tags.push('hidden-iframe');
      break;
    }

    case 'script': {
      const script = el as HTMLScriptElement;
      if (script.src) {
        if (isStrictlyExternalUrl(script.src)) tags.push('external-script');
      } else {
        tags.push('inline-script');
        const content = script.textContent || '';
        const suspicious = detectSuspiciousPatterns(content);
        if (suspicious.length > 0) {
          tags.push('suspicious-script');
          suspicious.forEach((s) => tags.push(`pattern:${s}`));
        }
      }
      break;
    }

    case 'button': {
      if (hasSuspiciousInlineHandler(el)) tags.push('suspicious-button');
      break;
    }

    case 'select': {
      // select 本身風險較低，標記即可
      break;
    }
  }

  // 通用標籤 — 只標記「可疑隱藏」，正常 UI 隱藏不標記
  if (isSuspiciouslyHidden(el) && tagName !== 'script') {
    tags.push('hidden-element');
  }
  // inline handler 在導航上下文中很常見 (React/Vue 等)，不標記
  if (hasSuspiciousInlineHandler(el) && !inNav) {
    tags.push('has-inline-handler');
  }

  return tags;
}

// ----------------------------------------------------------
// 核心萃取函式
// ----------------------------------------------------------

/**
 * 萃取單一 DOM 元素的結構化特徵
 */
export function extractElementFeature(el: Element): ElementFeature {
  const tagName = el.tagName.toLowerCase();
  const rect = el.getBoundingClientRect();

  const feature: ElementFeature = {
    tag: tagName,
    isHidden: isHiddenElement(el),
    isExternal: false,
    hasSuspiciousHandler: hasSuspiciousInlineHandler(el),
    position: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
    },
    behaviorTags: classifyBehavior(el),
  };

  // 共用屬性
  const id = el.getAttribute('id');
  if (id) feature.id = id;

  const classes = Array.from(el.classList);
  if (classes.length > 0) feature.classes = classes;

  // 依標籤類型萃取特有屬性
  switch (tagName) {
    case 'input':
    case 'textarea':
    case 'select': {
      const input = el as HTMLInputElement;
      if (input.type) feature.type = input.type;
      if (input.name) feature.name = input.name;
      if (input.placeholder) feature.placeholder = input.placeholder;
      if (input.autocomplete) feature.autocomplete = input.autocomplete;
      break;
    }

    case 'a': {
      const anchor = el as HTMLAnchorElement;
      if (anchor.href) {
        feature.href = anchor.href;
        feature.isExternal = isExternalUrl(anchor.href);
      }
      if (anchor.target) feature.target = anchor.target;
      break;
    }

    case 'button': {
      const button = el as HTMLButtonElement;
      if (button.type) feature.type = button.type;
      if (button.name) feature.name = button.name;
      break;
    }

    case 'form': {
      const form = el as HTMLFormElement;
      if (form.action) {
        feature.action = form.action;
        feature.isExternal = isExternalUrl(form.action);
      }
      if (form.method) feature.method = form.method;
      feature.inputCount = form.querySelectorAll('input, textarea, select').length;
      break;
    }

    case 'iframe': {
      const iframe = el as HTMLIFrameElement;
      if (iframe.src) {
        feature.src = iframe.src;
        feature.isExternal = isExternalUrl(iframe.src);
      }
      const sandbox = iframe.getAttribute('sandbox');
      if (sandbox !== null) feature.sandbox = sandbox;
      break;
    }

    case 'script': {
      const script = el as HTMLScriptElement;
      if (script.src) {
        feature.src = script.src;
        feature.isExternal = isExternalUrl(script.src);
      } else {
        feature.inlineLength = (script.textContent || '').length;
      }
      break;
    }
  }

  return feature;
}

/**
 * 掃描整頁，萃取所有敏感元素的特徵並產出完整報告
 */
export function extractPageFeatures(): PageFeatureReport {
  const elements = document.querySelectorAll(SENSITIVE_SELECTORS);
  const features: ElementFeature[] = [];

  elements.forEach((el) => {
    features.push(extractElementFeature(el));
  });

  // 計算頁面統計摘要
  const meta: PageMeta = {
    totalInputs: document.querySelectorAll('input, textarea').length,
    totalForms: document.querySelectorAll('form').length,
    totalExternalLinks: new Set(
      features
        .filter((f) => f.tag === 'a' && f.isExternal && f.href)
        .map((f) => f.href)
    ).size,
    totalIframes: document.querySelectorAll('iframe').length,
    totalScripts: document.querySelectorAll('script').length,
    hasPasswordField:
      document.querySelectorAll('input[type="password"]').length > 0,
    hasCreditCardField: features.some((f) =>
      f.behaviorTags.includes('credit-card-field')
    ),
  };

  return {
    url: window.location.href,
    domain: window.location.hostname,
    timestamp: Date.now(),
    features,
    meta,
  };
}

/**
 * 局部掃描：僅萃取指定節點及其子樹中的敏感元素
 * 用於 MutationObserver 觸發的增量更新
 */
export function extractFeaturesFromSubtree(root: Element): ElementFeature[] {
  const features: ElementFeature[] = [];

  // 檢查 root 本身
  if (root.matches?.(SENSITIVE_SELECTORS)) {
    features.push(extractElementFeature(root));
  }

  // 檢查子樹
  const children = root.querySelectorAll(SENSITIVE_SELECTORS);
  children.forEach((el) => {
    features.push(extractElementFeature(el));
  });

  return features;
}
