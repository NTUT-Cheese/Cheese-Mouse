# Cheese Mouse 即時惡意內容防護擴充功能 — 實作待辦與架構規劃 (Todo & Roadmap)

本文件具體記錄 Cheese Mouse 的開發與進階功能藍圖，核心採用 **四層多模態分析架構 (Visual, Semantic, DOM, Behavioral)**，配合輕量化邊緣 AI 與快取機制，達到精準且高透明度的網頁防護。

---

## 階段一：四層多模態特徵萃取與壓縮引擎 (Multi-Layer Analysis Engine)
負責在瀏覽器端對網頁內容進行多維度分析，輕量化/壓縮後提供給 UI 展示與後續 AI 引擎推論。

- [x] **共用介面與架構規範 (`analyzers/types.ts`)**
  - [x] 制定統一的 `LayerResult<T>` 與各層專屬資料型別
- [x] **語意層分析與 DOM 壓縮 (`analyzers/semantic/index.ts`)**
  - [x] 整合 `@mozilla/readability` 進行 DOM 克隆與文章核心正文萃取
  - [x] 實作高壓縮比（大幅過濾廣告、導覽列與雜音 DOM，壓縮率達 90%+）
  - [x] 非文章頁面自動降級（Title + Meta Description 備援方案）
- [x] **DOM 結構分析層 (`analyzers/dom/index.ts` & `utils/extractor.ts`)**
  - [x] 密碼與敏感表單監控 (`<input type="password">`、隱藏 iframe、跨域提交表單)
  - [x] 腳本安全分析與內嵌 inline 腳本長度統計
  - [x] 具體目標 URL 列表生成與高風險行為標籤 (`behaviorTags`) 標註
- [ ] **行為層分析與動態攔截 (Dual-Core Behavioral Analysis)**
  - [x] **底層網路監控 (`background` - `webRequest`)**：統計外部請求頻率、Top 網域排行與已知惡意網域比對
  - [ ] **MAIN World 執行環境注入 (`entrypoints/injected.ts`)**：於 `document_start` 將 Hook 核心注入網頁主執行環境
  - [ ] **JS Listener 監控與替換 (`EventTarget.prototype.addEventListener`)**：
    - [ ] 攔截並記錄 `keydown`, `keyup`, `input`, `paste`, `submit` 等高風險事件註冊來源 (`Stack Trace` 追蹤)
    - [ ] 實作 Listener 替換/過濾機制，阻止惡意腳本攔截表單提交或偷取密碼欄位按鍵事件
    - [ ] 攔截反偵錯與防干擾事件（如 `contextmenu`, `copy`, `beforeunload`）
  - [ ] **敏感 API 與資料外洩監控 (API Monkey Patching)**：
    - [ ] Hook `fetch`, `XMLHttpRequest`, `sendBeacon`：即時掃描 Request Body 是否含有頁面敏感輸入內容（密碼/卡號偷渡檢測）
    - [ ] Hook `document.cookie` 與 `localStorage`：偵測第三方腳本竊取 Session Token 的嘗試
    - [ ] Hook `eval` 與 `Function`：捕獲並分析混淆腳本的動態解包（Unpacking） payload
  - [ ] **跨 World 雙向通訊機制**：將 MAIN World 捕獲的 JS 攔截/替換報告即時透傳給 Content Script 與 Sidebar 展示
- [ ] **視覺層分析引擎 (`analyzers/visual/index.ts`)**
  - [x] 建立分析器骨架與 UI 佔位介面
  - [ ] 實作網頁視覺截圖 (`browser.tabs.captureVisibleTab`)
  - [ ] 整合輕量化 AI 或特徵比對進行釣魚網站外觀仿冒偵測（如假冒登入介面）

---

## 階段二：高透明度 UI/UX 與即時監控 (`App.vue` & Score Logic)
提供清晰透明的評分與分層分析報告，避免對一般正常網站造成誤判與騷擾。

- [x] **側邊欄 (Sidebar) 互動與分層報告展示**
  - [x] 即時顯示安全分數指示器（低/中/高風險色彩與動態指針）
  - [x] **多層分析儀表板**：直觀展示語意層正文與壓縮率、行為層外部請求次數與可疑警告
  - [x] 展開具體敏感元素與來源 URL 詳情列表
  - [x] 支援依風險等級與行為標籤篩選特徵
- [ ] **風險評分演算法與權重校準**
  - [ ] 採用「單一元素最高風險分數 (Element-based max score)」或多維度綜合推論，避免純規則累加導致分數失真
  - [ ] 校準一般行為權重（如普通 SPA 網站的大量合規外部請求與腳本載入）

---

## 階段三：本地特徵快取與指紋資料庫 (Local Cache Lookup & Storage)
為避免對相同或類似頁面重複萃取與重複執行 AI 推論，建立快速查表與自訂白名單機制。

- [ ] **特徵快取架構設計 (3NF Schema & TTL)**
  - [ ] 規劃 Chrome Storage / IndexedDB 快取表架構（以網域或正文 Hash 作為 Key）
  - [ ] 實作快取過期與自動清除機制
- [ ] **快取比對與自訂名單介面 (Hit-Cache Flow)**
  - [ ] 若命中已知安全指紋或已知黑名單特徵，直接回傳評分並略過 LLM 推論
  - [ ] 允許使用者於 Sidebar 一鍵標註特定網域為「信任 (Whitelist)」或「封鎖 (Blacklist)」

---

## 階段四：WebLLM 輕量化邊緣 AI 推論核心 (Edge AI Inference)
於瀏覽器本地端利用 WebGPU 運行輕量化大語言模型（如 0.5B - 1B 參數），進行深層次綜合防禦與語意理解。

- [ ] **WebLLM 本地運行環境整合**
  - [ ] 在後台 Offscreen Document / Background 中載入 WebLLM (如 Qwen2.5-0.5B-Instruct 或 Llama-3 輕量量化版)
  - [ ] WebGPU 硬體加速偵測與自動降級策略 (Graceful Fallback)
- [ ] **多層特徵提示工程 (Multi-Layer Prompting)**
  - [ ] 設計 Prompt 模板，整合語意層正文、DOM 敏感標籤與行為層網路特徵
  - [ ] 規範模型回傳嚴格 JSON 報告 (`Credit Score`, `Threat Category`, `Confidence`)
- [ ] **效能與記憶體控制**
  - [ ] 非阻塞非同步推論，確保不影響主頁面流暢度

---

## 階段五：雙軌切換路由器與深度防禦 (Dual-Track Router & Enterprise/Cloud AI)
針對本地模型置信度不足或面臨高難度混淆攻擊時的動態分流機制。

- [ ] **雙軌切換路由器 (Router Logic) 實作**
  - [ ] 當本地 AI `Confidence < Threshold` 或偵測到高階混淆特徵時觸發分流
- [ ] **企業私有雲 / 本地大模型串接**
  - [ ] 支援介接內部網段 Ollama 或企業專屬 AI 伺服器（滿足敏感資料不過公網規範）
- [ ] **高階雲端 AI 引擎 API 串接**
  - [ ] 提供進階模式 API Key 設定（安全加密儲存於 Extension Storage）

---

## 階段六：主動攔截與安全預警介面 (Blocking & Audit)
針對確信為釣魚或高風險行為的網頁提供主動介入。

- [ ] **高風險頁面主動攔截遮罩 (Overlay Alert)**
  - [ ] 當信用評分低於警戒門檻，於目標頁面注入即時警告遮罩並阻止敏感表單送出
- [ ] **審核放行與稽核報告匯出**
  - [ ] 提供「我瞭解風險，單次放行」選項，並支援一鍵匯出該網頁的多層次安全分析報告 (JSON / PDF)
