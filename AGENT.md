# Cheese Mouse — AI Agent & Developer Guidelines (AGENT.md)

> This document serves as the authoritative architectural blueprint, data format specification, and coding rulebook for AI coding assistants (Antigravity, GitHub Copilot, Cursor, etc.) and human developers contributing to **Cheese Mouse**.

---

## 1. Project Vision & Core Architecture

**Cheese Mouse (起司老鼠)** is a real-time, client-side web security & anti-phishing/anti-malware browser extension built with **WXT + Vue 3 + TypeScript** (MV2/MV3 dual-compatible, initially targeting Firefox).

Unlike traditional static blacklist extensions, Cheese Mouse implements a **Four-Layer Multi-Modal Analysis Pipeline (四層多模態分析管線)** designed to extract, compress, and evaluate client-side threats in real-time, feeding high-density structured summaries into an in-browser edge AI model (**WebLLM** / WebGPU) and a transparent Sidebar UI.

```
+-----------------------------------------------------------------------------------+
|                            TARGET WEBPAGE (DOM / JS)                              |
+-----------------------------------------------------------------------------------+
         |                                           |
         v (Isolated World)                          v (MAIN World Hook)
+----------------------------------+       +------------------------------------+
|   Content Script (content.ts)    |       |   Injected Script (injected.ts)    |
| - MutationObserver (300ms deb.)  |       | - EventTarget.addEventListener     |
| - DOM Layer (extractor.ts)       |       | - fetch / XHR / sendBeacon Hook    |
| - Semantic Layer (Readability)   |       | - document.cookie / eval Hook      |
+----------------------------------+       +------------------------------------+
         |                                           |
         +--------------------+----------------------+
                              | (PostMessage / Extension Messaging)
                              v
+-----------------------------------------------------------------------------------+
|                        Background Script (background.ts)                          |
| - Behavioral Layer (webRequest API: external requests, top domains, C2/mining)    |
| - Multi-Layer Aggregation & Report Caching                                        |
+-----------------------------------------------------------------------------------+
                              |
         +--------------------+----------------------+
         |                                           |
         v                                           v
+----------------------------------+       +------------------------------------+
|  Sidebar UI (App.vue)            |       |  Edge AI Inference (Future Phase)  |
| - Transparent Score Indicator    |       | - WebLLM (Qwen2.5-0.5B / Llama-3)  |
| - Layer Breakdown & Details      |       | - Local Cache Lookup (3NF / TTL)   |
+----------------------------------+       +------------------------------------+
```

---

## 2. The Four Analysis Layers

### 1️⃣ Semantic Layer (`analyzers/semantic/index.ts`)
- **Purpose**: Compress noisy webpage HTML (ads, navbars, footers) into core article/content text using `@mozilla/readability`.
- **Key Metric**: `compressionRatio` (typically achieves 90%+ reduction). Optimizes LLM context window limits.
- **Rule**: `Readability.parse()` mutates DOM in-place. **Always pass a cloned DOM** (`document.cloneNode(true)`) to the constructor.

### 2️⃣ DOM Structural Layer (`analyzers/dom/index.ts` & `utils/extractor.ts`)
- **Purpose**: Extract high-risk structural elements and tag them with `behaviorTags`.
- **Target Features**: `<input type="password">`, hidden `<iframe isHidden=true>`, cross-origin `<form action="...">`, inline script lengths.
- **Output**: Array of `ElementFeature` objects and `PageMeta` summary statistics.

### 3️⃣ Behavioral Layer (`analyzers/behavioral/index.ts` & `injected.ts`)
- **Dual-Core Architecture**:
  1. **Network Core (`background.ts` via `webRequest`)**: Tracks external HTTP requests, groups by domain/type, and flags excessive requests (>50) or known cryptomining/C2 domains.
  2. **Runtime Core (`MAIN` World via `injected.ts` — In Progress)**: Injects at `document_start` to monkey-patch and monitor `EventTarget.prototype.addEventListener` (keylogging/form interception), `window.fetch`/`XMLHttpRequest` (data exfiltration with sensitive payload scanning), `document.cookie`, and `eval`.

### 4️⃣ Visual Layer (`analyzers/visual/index.ts` — Placeholder)
- **Purpose**: Capture viewport screenshots (`browser.tabs.captureVisibleTab`) and extract dominant color palettes/brand logos to detect visual phishing (e.g., fake login interfaces).

---

## 3. Core Data Contracts & Schemas

When writing code across modules, strictly adhere to the types defined across `utils/types.ts` and `analyzers/types.ts`.

### A. Universal Envelope (`LayerResult<T>`)
Every layer returns its analysis wrapped in:
```typescript
export interface LayerResult<T> {
  layer: 'visual' | 'semantic' | 'dom' | 'behavioral';
  timestamp: number;
  durationMs: number;
  success: boolean;
  error?: string;
  data: T;
}
```

### B. Extension Message Protocol (`ExtensionMessage`)
Communication between Content Script, Background Script, and Sidebar UI uses typed payloads:
```typescript
export type ExtensionMessage =
  | { type: 'PAGE_FEATURES'; payload: PageFeatureReport }
  | { type: 'SCAN_REQUEST' }
  | { type: 'SCAN_RESULT'; payload: { score: number; url: string; timestamp: number } }
  | { type: 'GET_LATEST_REPORT' }
  | { type: 'TAB_CHANGED'; payload: { tabId: number; url?: string } };
```

### C. Complete Report Structure (`PageFeatureReport`)
```json
{
  "url": "https://target-domain.com/login",
  "domain": "target-domain.com",
  "timestamp": 1752634393000,
  "meta": {
    "totalInputs": 3,
    "totalForms": 1,
    "totalExternalLinks": 12,
    "totalIframes": 1,
    "totalScripts": 8,
    "hasPasswordField": true,
    "hasCreditCardField": false
  },
  "features": [
    {
      "tag": "input",
      "id": "pwd",
      "type": "password",
      "isHidden": false,
      "isExternal": false,
      "hasSuspiciousHandler": true,
      "position": { "x": 450, "y": 320 },
      "behaviorTags": ["password-field", "suspicious-handler"]
    }
  ],
  "compressed": {
    "title": "Page Title",
    "byline": "Author Name",
    "siteName": "Site Name",
    "excerpt": "Short summary...",
    "textContent": "Clean full text content without ads...",
    "fullTextLength": 4520,
    "originalDomLength": 89400,
    "compressionRatio": 0.05,
    "isParseable": true,
    "lang": "zh-TW"
  },
  "behavioral": {
    "externalRequests": {
      "total": 14,
      "byDomain": { "tracker.example.com": 8 },
      "byType": { "xmlhttprequest": 10, "script": 4 }
    },
    "suspiciousEvents": [
      {
        "type": "excessive-requests",
        "description": "Detected 14 external requests exceeding threshold.",
        "timestamp": 1752634394000
      }
    ]
  }
}
```

---

## 4. Critical Guidelines for AI Agents & Developers

When modifying or generating code for Cheese Mouse, **YOU MUST FOLLOW THESE RULES**:

### Rule 1: WXT Module Scope & Type Imports
- **Entrypoints (`entrypoints/`)**: WXT automatically injects `browser` and `defineBackground` / `defineContentScript` into entrypoint files.
- **Non-Entrypoints (`analyzers/`, `utils/`)**: WXT does **NOT** auto-import globals here. If you need browser APIs or types in `analyzers/` or `utils/`, explicitly import from `wxt/browser`:
  ```typescript
  import type { Browser } from 'wxt/browser';
  // Note: WXT uses lowercase property names matching runtime APIs:
  // CORRECT:   Browser.webRequest.OnBeforeRequestDetails
  // INCORRECT: browser.WebRequest.OnBeforeRequestDetailsType
  ```
- **Permissions**: Any new Chrome/Firefox API used (e.g., `webRequest`, `storage`, `captureVisibleTab`) must be explicitly declared in `wxt.config.ts` (`manifest.permissions`).

### Rule 2: World Isolation (ISOLATED vs MAIN)
- **Content Scripts (`content.ts`)** run in an **ISOLATED world**. Overriding `window.addEventListener` or `window.fetch` inside `content.ts` ONLY hooks the extension itself and leaves the webpage untouched.
- **MAIN World Hooking**: To intercept webpage JS listeners or API calls, you MUST inject a script (`injected.ts`) into the `MAIN` world at `document_start` and bridge data back via secure `window.postMessage` to `content.ts`.

### Rule 3: DOM Mutation & Readability Safety
- Never pass `window.document` directly to `new Readability()`. It strips `<script>`, `<style>`, and modifies node structures in place, breaking webpage functionality.
- Always use: `const clonedDoc = document.cloneNode(true) as Document;`

### Rule 4: UI/UX & Design System (`App.vue`)
- Use **Vanilla CSS** scoped (`<style scoped>`). Do not introduce TailwindCSS or UI component libraries unless instructed.
- Maintain our **Premium Dark Mode Glassmorphism** aesthetic:
  - Backgrounds: `#0a0b0d`, `rgba(255, 255, 255, 0.03)` with subtle `1px solid rgba(255, 255, 255, 0.06)` borders.
  - Status Colors: `#2ed573` (OK/Success), `#ffa502` (Warning), `#ff4757` (Danger/Critical).
  - Typography: Crisp sans-serif with `SF Mono` / `Fira Code` for technical metrics (domains, KB counts, percentages).
- Keep the UI highly responsive and transparent—every score or behavior tag must allow user drill-down to view underlying target URLs or scripts.

### Rule 5: Dev Server & Port Stability (`strictPort: true`)
- `wxt.config.ts` locks Vite to **Port 3000** (`strictPort: true`) and keeps profile changes (`keepProfileChanges: true`).
- If port conflicts occur after terminating `npm run dev` (`Ctrl+C`), do **NOT** change the port to 3001 (which breaks hardcoded Vite script links in `sidebar.html` and causes a blank/white screen).
- Instead, run `npm run dev:clean` or `npm run clean` to wipe `.output` and `.wxt/firefox-profile` cleanly.

### Rule 6: Documentation Integrity & Task Tracking
- When adding features or changing architecture, keep `todo.md` updated.
- Preserve existing comments and docstrings across `utils/` and `analyzers/` unless specifically refactoring that code block.
- Verify TypeScript compilation cleanliness before finishing tasks using `npm run compile` (`vue-tsc --noEmit`) or `npm run dev`.

---

## 5. Development Commands

| Command | Description |
| :--- | :--- |
| `npm run dev` | Start WXT dev server locked to Port 3000 (`wxt -b firefox`) |
| `npm run dev:clean` | Wipe build caches (`.output` & `.wxt/firefox-profile`) and start dev server |
| `npm run clean` | Clean generated files and caches (`wxt clean`) |
| `npm run compile` | Run `vue-tsc --noEmit` to verify type safety across Vue/TS files |
| `npm run build` | Build production package for Firefox |

---

## 6. Advanced Security & Architectural Gotchas

When implementing the advanced phases (MAIN world injection, local caching, and WebLLM inference), strictly observe these three architectural boundaries:

### 1. Cross-World Message Authentication
- **The Threat**: When `injected.ts` (`MAIN` world) sends intercepted JS listener/exfiltration alerts to `content.ts` (`ISOLATED` world) via `window.postMessage()`, **any malicious script residing on the target webpage can also call `window.postMessage()`**.
- **The Defense**: Never blindly trust incoming `postMessage` payloads in `content.ts`.
- **Implementation Protocol**:
  - When `content.ts` injects `injected.ts` at `document_start`, it must generate a cryptographically secure random string (`X-Cheese-Nonce`) via `crypto.randomUUID()`.
  - Pass this nonce once to `injected.ts` via dataset attribute or initial handshake setup.
  - Every subsequent message from `injected.ts` to `content.ts` MUST attach this `nonce`. `content.ts` must silently discard any `message` event lacking the valid nonce.

### 2. CSP Strictness & No-Eval Enforcement
- Because `Cheese Mouse` operates under strict Extension Content Security Policy (CSP), **`eval()` and `new Function()` are permanently blocked inside extension origins** (`background.ts`, `content.ts`, `sidebar`).
- While `injected.ts` hooks `eval()` inside the webpage's `MAIN` world to catch malware unpacking, AI agents must **NEVER** write code that attempts dynamic evaluation (`eval`, `new Function`, `setTimeout("...")`) within our own extension codebase.

### 3. WebLLM / WebGPU Execution Boundary
- When building **Phase 4 (WebLLM Edge Inference)**, note the runtime restrictions of browser extensions:
  - **Cannot run in Content Scripts**: Loading a 0.5B~1B LLM inside `content.ts` freezes the target webpage's main thread and violates CORS/CSP rules.
  - **Cannot run in MV3 Service Workers**: Pure Service Workers lack access to `WebGPU` and `DOM/Canvas` APIs required by WebLLM (`@mlc-ai/web-llm`).
- **Required Architecture**: WebLLM MUST be initialized inside an **Offscreen Document (`browser.offscreen` for Chrome MV3)** or a persistent hidden `moz-extension://` iframe/Web Worker controlled by `background.ts`. All prompt requests from `background.ts` to the WebLLM engine must be processed asynchronously via message passing.
