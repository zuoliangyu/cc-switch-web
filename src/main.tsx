import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "./i18n";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/components/theme-provider";
import { queryClient } from "@/lib/query";
import { Toaster } from "@/components/ui/sonner";
import { UpdateProvider } from "@/contexts/UpdateContext";
import { AccessKeyGate } from "@/components/AccessKeyGate";
import {
  MODELS_DEV_SYNC_CONFIG_QUERY_KEY,
  syncModelsDevPricingOnStartup,
} from "@/lib/modelsDevAutoSync";

// 根据平台添加 body class，便于平台特定样式
try {
  const ua = navigator.userAgent || "";
  const plat = (navigator.platform || "").toLowerCase();
  const isMac = /mac/i.test(ua) || plat.includes("mac");
  if (isMac) {
    document.body.classList.add("is-mac");
  }
} catch {
  // 忽略平台检测失败
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="system" storageKey="cc-switch-theme">
        <UpdateProvider>
          <AccessKeyGate>
            <App />
          </AccessKeyGate>
          <Toaster />
        </UpdateProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);

void syncModelsDevPricingOnStartup()
  .then((result) => {
    if (!result.skipped) {
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ["usage"] }),
        queryClient.invalidateQueries({
          queryKey: MODELS_DEV_SYNC_CONFIG_QUERY_KEY,
        }),
      ]);
    }
  })
  .catch((error) => {
    // 离线或 models.dev 暂时不可用不应阻塞页面启动。
    console.warn("[models.dev] startup sync failed", error);
    void queryClient.invalidateQueries({
      queryKey: MODELS_DEV_SYNC_CONFIG_QUERY_KEY,
    });
  });
