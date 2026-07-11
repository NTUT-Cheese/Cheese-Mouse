import { defineConfig } from 'wxt';
import { resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

const firefoxProfilePath = resolve('.wxt/firefox-profile');

if (!existsSync(firefoxProfilePath)) {
  mkdirSync(firefoxProfilePath, { recursive: true });
}

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    sidebar_action: {
      default_panel: "sidebar.html",
      default_title: "Cheese Mouse",
      default_icon: "icon/48.png"
    },
    browser_action: {
      default_title: "Cheese Mouse",
      default_icon: {
        "16": "icon/16.png",
        "32": "icon/32.png",
        "48": "icon/48.png",
      },
    },
    browser_specific_settings: {
      gecko: {
        id: 'cheese-mouse@e88e89.dev',
        strict_min_version: '109.0',
      },
    },
  },
  webExt: {
    firefoxProfile: firefoxProfilePath,
    keepProfileChanges: true,
  },
});
