<script lang="ts" setup>
import { ref, computed, onMounted } from 'vue';
import type { PageFeatureReport, ElementFeature } from '@/utils/types';

// ----------------------------------------------------------
// State
// ----------------------------------------------------------
const report = ref<PageFeatureReport | null>(null);
const isLoading = ref(false);
const error = ref<string | null>(null);
const expandedTags = ref<Set<string>>(new Set());

// ----------------------------------------------------------
// Computed
// ----------------------------------------------------------
const riskyFeatures = computed(() => {
  if (!report.value) return [];
  return report.value.features.filter((f) =>
    f.behaviorTags.some((tag) => (TAG_WEIGHTS[tag] ?? 0) > 0 || tag.startsWith('pattern:'))
  );
});

/**
 * 行為標籤風險權重
 * 只有真正可疑的標籤才計入風險分數
 * 導航上下文、資訊性標籤不計入
 */
const TAG_WEIGHTS: Record<string, number> = {
  // 高風險 — 直接影響安全
  'suspicious-script': 10,
  'hidden-iframe': 10,
  'external-form': 8,
  'javascript-href': 8,
  'data-href': 8,
  'suspicious-button': 7,
  'hidden-element': 6,

  // 中低風險 — 降到最低或不計分，避免對正常大流量網站誤判
  'external-iframe': 1,
  'unsandboxed-iframe': 1,
  'external-link': 0,      // 外部連結在現代網站非常普遍，不計入風險分數
  'new-window-link': 0,    // 不計入
  'external-script': 0,    // 外部 cdn 腳本極為常見，不計入風險分數

  // 資訊性 — 不計入風險
  'nav-external-link': 0,
  'password-field': 0,
  'email-field': 0,
  'phone-field': 0,
  'credit-card-field': 0,
  'hidden-input': 0,
  'login-form': 0,
  'post-form': 0,
  'inline-script': 0,
  'has-inline-handler': 0,
};

const riskScore = computed(() => {
  if (!report.value) return 0;
  let score = 0;
  for (const f of report.value.features) {
    let elementMaxScore = 0;
    for (const tag of f.behaviorTags) {
      if (tag.startsWith('pattern:')) continue; // pattern 只用於列表原因說明，不重複計分
      const weight = TAG_WEIGHTS[tag] ?? 0;
      elementMaxScore = Math.max(elementMaxScore, weight);
    }
    score += elementMaxScore;
  }
  return score;
});

const riskLevel = computed(() => {
  if (!report.value) return 'unknown';
  const s = riskScore.value;
  if (s >= 15) return 'high';  // 相當於 2 個以上的高危元素，或 1 高危 + 1 中危
  if (s >= 7) return 'medium'; // 相當於 1 個高危元素 (如 eval script/hidden iframe) 或外部表單
  if (s >= 1) return 'low';    // 僅有輕微風險標籤 (如 unsandboxed iframe 等)
  return 'safe';
});

const riskColor = computed(() => {
  switch (riskLevel.value) {
    case 'high': return '#ff4757';
    case 'medium': return '#ffa502';
    case 'low': return '#2ed573';
    case 'safe': return '#7bed9f';
    default: return '#747d8c';
  }
});

const riskLabel = computed(() => {
  switch (riskLevel.value) {
    case 'high': return '高風險';
    case 'medium': return '中風險';
    case 'low': return '低風險';
    case 'safe': return '安全';
    default: return '未掃描';
  }
});

const scanTime = computed(() => {
  if (!report.value) return '--';
  return new Date(report.value.timestamp).toLocaleTimeString();
});

// ----------------------------------------------------------
// Methods
// ----------------------------------------------------------
async function fetchReport(): Promise<void> {
  isLoading.value = true;
  error.value = null;
  try {
    const result = await browser.runtime.sendMessage({ type: 'GET_LATEST_REPORT' });
    if (result) {
      report.value = result as PageFeatureReport;
    } else {
      report.value = null;
      // 快取報告為空時，主動發起掃描
      await requestScan();
    }
  } catch (e) {
    console.debug('[Sidebar] Failed to fetch report:', e);
  } finally {
    isLoading.value = false;
  }
}

async function requestScan(): Promise<void> {
  isLoading.value = true;
  error.value = null;
  try {
    await browser.runtime.sendMessage({ type: 'SCAN_REQUEST' });
    // 等待一小段時間讓 content script 完成掃描
    await new Promise((r) => setTimeout(r, 800));
    const result = await browser.runtime.sendMessage({ type: 'GET_LATEST_REPORT' });
    if (result) {
      report.value = result as PageFeatureReport;
    }
  } catch (e) {
    error.value = '無法連接到頁面';
    console.debug('[Sidebar] Scan failed:', e);
  } finally {
    isLoading.value = false;
  }
}

function toggleTag(tag: string): void {
  if (expandedTags.value.has(tag)) {
    expandedTags.value.delete(tag);
  } else {
    expandedTags.value.add(tag);
  }
}

function getTagIcon(tag: string): string {
  if (tag.includes('password') || tag.includes('login')) return '🔑';
  if (tag.includes('credit-card')) return '💳';
  if (tag.includes('email')) return '📧';
  if (tag.includes('phone')) return '📱';
  if (tag === 'nav-external-link') return '🧭';
  if (tag.includes('hidden')) return '👁️‍🗨️';
  if (tag.includes('external')) return '🔗';
  if (tag.includes('suspicious') || tag.startsWith('pattern:')) return '⚠️';
  if (tag.includes('iframe')) return '🪟';
  if (tag.includes('script')) return '📜';
  if (tag.includes('form')) return '📋';
  return '🏷️';
}

function getFeatureLabel(f: ElementFeature): string {
  let details = '';
  if (f.tag === 'a' && f.href) {
    const shortUrl = f.href.length > 50 ? f.href.substring(0, 47) + '...' : f.href;
    details = ` href="${shortUrl}"`;
  } else if (f.tag === 'form' && f.action) {
    const shortUrl = f.action.length > 50 ? f.action.substring(0, 47) + '...' : f.action;
    details = ` action="${shortUrl}"`;
  } else if ((f.tag === 'script' || f.tag === 'iframe') && f.src) {
    const shortUrl = f.src.length > 50 ? f.src.substring(0, 47) + '...' : f.src;
    details = ` src="${shortUrl}"`;
  } else {
    if (f.id) details += `#${f.id}`;
    if (f.name) details += `[name="${f.name}"]`;
    if (f.type) details += ` type="${f.type}"`;
  }
  return `<${f.tag}${details}>`;
}

function groupByTag(features: ElementFeature[]): Record<string, ElementFeature[]> {
  const groups: Record<string, ElementFeature[]> = {};
  const seenUrlsByTag: Record<string, Set<string>> = {};

  for (const f of features) {
    for (const tag of f.behaviorTags) {
      // 僅展示真正有風險分值或可疑 pattern 的標籤，不顯示無風險的 neutral 標籤
      const weight = TAG_WEIGHTS[tag] ?? 0;
      if (weight === 0 && !tag.startsWith('pattern:')) {
        continue;
      }

      if (!groups[tag]) {
        groups[tag] = [];
        seenUrlsByTag[tag] = new Set();
      }

      // 取得元素的主要連結 URL (href, src, 或 action) 進行去重
      const elementUrl = f.href || f.src || f.action;
      if (elementUrl) {
        if (seenUrlsByTag[tag].has(elementUrl)) {
          continue; // 同一個分組中，重複 URL 的特徵不再重複加入
        }
        seenUrlsByTag[tag].add(elementUrl);
      }

      groups[tag].push(f);
    }
  }
  return groups;
}

// ----------------------------------------------------------
// Lifecycle
// ----------------------------------------------------------
onMounted(() => {
  fetchReport();

  // 監聽來自 background 的更新與 tab 切換
  browser.runtime.onMessage.addListener(async (message: any) => {
    if (message.type === 'PAGE_FEATURES') {
      try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        const currentUrl = tabs[0]?.url;
        if (currentUrl) {
          const currentHostname = new URL(currentUrl).hostname;
          const reportHostname = new URL(message.payload.url).hostname;
          if (currentHostname === reportHostname) {
            report.value = message.payload;
          }
        }
      } catch (e) {
        report.value = message.payload;
      }
    } else if (message.type === 'TAB_CHANGED') {
      // 切換或載入新頁面，重新取得或發起掃描
      report.value = null;
      await fetchReport();
    }
  });
});
</script>

<template>
  <div id="sidebar">
    <!-- Header -->
    <header class="sidebar-header">
      <div class="header-brand">
        <span class="brand-icon">🧀</span>
        <h1 class="brand-title">Cheese Mouse</h1>
      </div>
      <p class="brand-subtitle">即時惡意內容防護</p>
    </header>

    <!-- Risk Indicator -->
    <section class="risk-section">
      <div class="risk-ring" :style="{ '--ring-color': riskColor }">
        <div class="risk-inner">
          <span class="risk-label">{{ riskLabel }}</span>
          <span class="risk-count" v-if="report">
            風險分數 {{ riskScore }}
          </span>
        </div>
      </div>
    </section>

    <!-- Action Button -->
    <section class="action-section">
      <button
        class="scan-button"
        :class="{ loading: isLoading }"
        :disabled="isLoading"
        @click="requestScan"
      >
        <span class="scan-icon" :class="{ spinning: isLoading }">⟳</span>
        {{ isLoading ? '掃描中...' : '重新掃描' }}
      </button>
    </section>

    <!-- Error -->
    <div v-if="error" class="error-banner">
      {{ error }}
    </div>

    <!-- Page Info -->
    <section v-if="report" class="info-section">
      <div class="info-card">
        <div class="info-row">
          <span class="info-label">網域</span>
          <span class="info-value domain">{{ report.domain }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">掃描時間</span>
          <span class="info-value">{{ scanTime }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">元素數量</span>
          <span class="info-value">{{ report.features.length }}</span>
        </div>
      </div>
    </section>

    <!-- Stats Grid -->
    <section v-if="report" class="stats-section">
      <h2 class="section-title">頁面統計</h2>
      <div class="stats-grid">
        <div class="stat-item">
          <span class="stat-value">{{ report.meta.totalInputs }}</span>
          <span class="stat-label">輸入欄位</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{{ report.meta.totalForms }}</span>
          <span class="stat-label">表單</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{{ report.meta.totalExternalLinks }}</span>
          <span class="stat-label">外部連結</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{{ report.meta.totalIframes }}</span>
          <span class="stat-label">Iframe</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{{ report.meta.totalScripts }}</span>
          <span class="stat-label">Script</span>
        </div>
        <div class="stat-item" :class="{ highlight: report.meta.hasPasswordField }">
          <span class="stat-value">{{ report.meta.hasPasswordField ? '⚠️' : '✓' }}</span>
          <span class="stat-label">密碼欄位</span>
        </div>
      </div>
    </section>

    <!-- Behavior Tags -->
    <section v-if="riskyFeatures.length > 0" class="tags-section">
      <h2 class="section-title">行為標籤</h2>
      <div class="tags-list">
        <div
          v-for="(elements, tag) in groupByTag(riskyFeatures)"
          :key="tag"
          class="tag-group"
        >
          <button class="tag-header" @click="toggleTag(tag)">
            <span class="tag-icon">{{ getTagIcon(tag) }}</span>
            <span class="tag-name">
              {{ tag }}
              <span v-if="TAG_WEIGHTS[tag]" class="tag-score-badge">+{{ TAG_WEIGHTS[tag] }}</span>
            </span>
            <span class="tag-count">{{ elements.length }}</span>
            <span class="tag-chevron" :class="{ expanded: expandedTags.has(tag) }">›</span>
          </button>
          <div v-if="expandedTags.has(tag)" class="tag-details">
            <div
              v-for="(el, idx) in elements"
              :key="idx"
              class="tag-element"
            >
              <code>{{ getFeatureLabel(el) }}</code>
              <span v-if="el.isHidden" class="badge badge-hidden">隱藏</span>
              <span v-if="el.isExternal" class="badge badge-external">外部</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Empty State -->
    <section v-if="!report && !isLoading" class="empty-section">
      <div class="empty-icon">🔍</div>
      <p class="empty-text">尚未掃描此頁面</p>
      <p class="empty-hint">點擊「重新掃描」開始分析</p>
    </section>

    <!-- Footer -->
    <footer class="sidebar-footer">
      <span class="footer-text">Cheese Mouse v0.1</span>
    </footer>
  </div>
</template>

<style scoped>
#sidebar {
  width: 100%;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  gap: 0;
  padding-bottom: 60px;
}

/* ---- Header ---- */
.sidebar-header {
  padding: 20px 16px 16px;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.header-brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand-icon {
  font-size: 28px;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
}

.brand-title {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.3px;
  background: linear-gradient(135deg, #ffd32a, #ffb142);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.brand-subtitle {
  margin-top: 4px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  letter-spacing: 0.5px;
}

/* ---- Risk Section ---- */
.risk-section {
  display: flex;
  justify-content: center;
  padding: 24px 16px 16px;
}

.risk-ring {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  background: conic-gradient(
    var(--ring-color) 0deg,
    var(--ring-color) 270deg,
    rgba(255, 255, 255, 0.05) 270deg
  );
  display: flex;
  align-items: center;
  justify-content: center;
  animation: pulse-ring 3s ease-in-out infinite;
}

@keyframes pulse-ring {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.05); }
  50% { box-shadow: 0 0 20px 4px color-mix(in srgb, var(--ring-color) 25%, transparent); }
}

.risk-inner {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  background: #1a1a2e;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

.risk-label {
  font-size: 18px;
  font-weight: 700;
  color: var(--ring-color);
}

.risk-count {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
}

/* ---- Action Section ---- */
.action-section {
  padding: 0 16px 16px;
}

.scan-button {
  width: 100%;
  padding: 10px 16px;
  border: none;
  border-radius: 10px;
  background: linear-gradient(135deg, #0f3460, #16213e);
  color: rgba(255, 255, 255, 0.85);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.scan-button:hover:not(:disabled) {
  background: linear-gradient(135deg, #1a4a8a, #1e2d50);
  border-color: rgba(255, 255, 255, 0.15);
  transform: translateY(-1px);
}

.scan-button:active:not(:disabled) {
  transform: translateY(0);
}

.scan-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.scan-icon {
  font-size: 16px;
  display: inline-block;
  transition: transform 0.3s ease;
}

.scan-icon.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* ---- Error ---- */
.error-banner {
  margin: 0 16px;
  padding: 8px 12px;
  background: rgba(255, 71, 87, 0.12);
  border: 1px solid rgba(255, 71, 87, 0.25);
  border-radius: 8px;
  color: #ff6b81;
  font-size: 12px;
  text-align: center;
}

/* ---- Info Section ---- */
.info-section {
  padding: 0 16px 12px;
}

.info-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.info-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.info-value {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.8);
  font-weight: 500;
}

.info-value.domain {
  font-family: 'SF Mono', 'Fira Code', monospace;
  color: #ffd32a;
  font-size: 11px;
}

/* ---- Stats Grid ---- */
.section-title {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.5);
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin-bottom: 10px;
}

.stats-section {
  padding: 12px 16px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.stat-item {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  padding: 10px 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  transition: border-color 0.2s ease;
}

.stat-item.highlight {
  border-color: rgba(255, 71, 87, 0.3);
  background: rgba(255, 71, 87, 0.06);
}

.stat-value {
  font-size: 18px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.85);
}

.stat-label {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  text-align: center;
}

/* ---- Tags Section ---- */
.tags-section {
  padding: 12px 16px;
}

.tags-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tag-group {
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.tag-header {
  width: 100%;
  padding: 8px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: none;
  color: rgba(255, 255, 255, 0.8);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s ease;
  text-align: left;
}

.tag-header:hover {
  background: rgba(255, 255, 255, 0.06);
}

.tag-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.tag-name {
  flex: 1;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.tag-score-badge {
  background: rgba(255, 71, 87, 0.15);
  color: #ff4757;
  padding: 1px 4px;
  border-radius: 4px;
  font-size: 9px;
  font-weight: 700;
}

.tag-count {
  background: rgba(255, 255, 255, 0.08);
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
}

.tag-chevron {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.3);
  transition: transform 0.2s ease;
  flex-shrink: 0;
}

.tag-chevron.expanded {
  transform: rotate(90deg);
}

.tag-details {
  padding: 4px 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: rgba(0, 0, 0, 0.15);
}

.tag-element {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.tag-element code {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.6);
  font-family: 'SF Mono', 'Fira Code', monospace;
  background: rgba(255, 255, 255, 0.04);
  padding: 2px 6px;
  border-radius: 4px;
}

.badge {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 4px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.badge-hidden {
  background: rgba(255, 165, 2, 0.15);
  color: #ffa502;
}

.badge-external {
  background: rgba(99, 110, 255, 0.15);
  color: #636eff;
}

/* ---- Empty State ---- */
.empty-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 16px;
  gap: 8px;
}

.empty-icon {
  font-size: 48px;
  opacity: 0.3;
}

.empty-text {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.5);
  font-weight: 500;
}

.empty-hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.25);
}

/* ---- Footer ---- */
.sidebar-footer {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 10px 16px;
  text-align: center;
  background: linear-gradient(to top, #1a1a2e, transparent);
}

.footer-text {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.2);
  letter-spacing: 0.5px;
}
</style>
