import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { codeInspectorPlugin } from "code-inspector-plugin";
import packageJson from "./package.json";

// 按依赖族拆分稳定的 vendor chunk：便于浏览器长期缓存，也避免单个超大 chunk。
// CodeMirror 按依赖层次拆成三块（core ← lang ← extras），块之间只有单向引用，
// 不会形成循环 chunk。
const VENDOR_CHUNKS: Array<[string, string[]]> = [
  [
    "vendor-codemirror-core",
    [
      "@codemirror/state",
      "@codemirror/view",
      "@marijn/find-cluster-break",
      "style-mod",
      "w3c-keyname",
      "crelt",
    ],
  ],
  [
    "vendor-codemirror-lang",
    [
      "@lezer",
      "@codemirror/language",
      "@codemirror/lang-css",
      "@codemirror/lang-html",
      "@codemirror/lang-javascript",
      "@codemirror/lang-json",
      "@codemirror/lang-markdown",
      "@codemirror/autocomplete",
      "@codemirror/commands",
    ],
  ],
  [
    "vendor-codemirror-extras",
    [
      "@codemirror/search",
      "@codemirror/lint",
      "@codemirror/theme-one-dark",
      "codemirror",
    ],
  ],
  [
    "vendor-charts",
    [
      "recharts",
      "victory-vendor",
      "decimal.js-light",
      "@reduxjs",
      "redux",
      "immer",
      "reselect",
    ],
  ],
  ["vendor-motion", ["framer-motion", "motion-dom", "motion-utils"]],
  ["vendor-radix", ["@radix-ui", "@floating-ui", "cmdk"]],
  ["vendor-icons", ["lucide-react"]],
  ["vendor-react", ["react", "react-dom", "scheduler"]],
  ["vendor-forms", ["react-hook-form", "@hookform", "zod"]],
  ["vendor-dnd", ["@dnd-kit"]],
  ["vendor-i18n", ["i18next", "react-i18next"]],
  ["vendor-query", ["@tanstack"]],
  [
    "vendor-misc",
    [
      "sonner",
      "tailwind-merge",
      "flexsearch",
      "clsx",
      "class-variance-authority",
    ],
  ],
];

// 体积大、无运行时依赖（或只依赖同组模块）的应用数据单独成块，仍随首屏加载。
// 所有预设都引用 claudeProviderPresets，因此它放在被依赖的 presets-base 中。
const APP_DATA_CHUNKS: Array<[string, string[]]> = [
  ["locale-zh", ["src/i18n/locales/zh.json"]],
  ["locale-en", ["src/i18n/locales/en.json"]],
  ["locale-ja", ["src/i18n/locales/ja.json"]],
  [
    "icons-data",
    ["src/icons/extracted/index.ts", "src/icons/extracted/metadata.ts"],
  ],
  [
    "presets-base",
    [
      "src/config/claudeProviderPresets.ts",
      "src/config/geminiProviderPresets.ts",
      "src/config/universalProviderPresets.ts",
    ],
  ],
  [
    "presets-coding",
    [
      "src/config/openclawProviderPresets.ts",
      "src/config/codexProviderPresets.ts",
      "src/config/opencodeProviderPresets.ts",
    ],
  ],
  [
    "presets-agents",
    [
      "src/config/piProviderPresets.ts",
      "src/config/piModelCatalog.ts",
      "src/config/piThinkingProfiles.ts",
      "src/config/mcodeProviderPresets.ts",
      "src/config/hermesProviderPresets.ts",
      "src/config/claudeDesktopProviderPresets.ts",
    ],
  ],
];

function packageNameFromId(id: string): string | undefined {
  const marker = "/node_modules/";
  const normalized = id.replace(/\\/g, "/");
  const index = normalized.lastIndexOf(marker);
  if (index < 0) return undefined;
  const parts = normalized.slice(index + marker.length).split("/");
  return parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
}

function manualChunks(id: string): string | undefined {
  const normalized = id.replace(/\\/g, "/");
  for (const [chunk, files] of APP_DATA_CHUNKS) {
    if (files.some((file) => normalized.endsWith(`/${file}`))) {
      return chunk;
    }
  }
  const name = packageNameFromId(id);
  if (!name) return undefined;
  for (const [chunk, packages] of VENDOR_CHUNKS) {
    if (
      packages.some((pkg) => name === pkg || name.startsWith(`${pkg}/`)) ||
      (chunk === "vendor-charts" && name.startsWith("d3-"))
    ) {
      return chunk;
    }
  }
  // 未列出的依赖交给 Rollup 默认分配，按需 import() 的包（如 Prettier）才能保持独立 chunk
  return undefined;
}

export default defineConfig(({ command }) => ({
  root: "src",
  plugins: [
    command === "serve" &&
      codeInspectorPlugin({
        bundler: "vite",
      }),
    react(),
  ].filter(Boolean),
  base: "./",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8890",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  envPrefix: ["VITE_"],
}));
