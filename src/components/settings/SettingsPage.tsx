import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { motion } from "framer-motion";
import {
  Loader2,
  Save,
  FolderSearch,
  Database,
  Cloud,
  Palette,
  ScrollText,
  HardDriveDownload,
  FlaskConical,
  History,
  KeyRound,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ToggleRow } from "@/components/ui/toggle-row";
import { LanguageSettings } from "@/components/settings/LanguageSettings";
import { ThemeSettings } from "@/components/settings/ThemeSettings";
import { AppVisibilitySettings } from "@/components/settings/AppVisibilitySettings";
import { SkillStorageLocationSettings } from "@/components/settings/SkillStorageLocationSettings";
import { SkillSyncMethodSettings } from "@/components/settings/SkillSyncMethodSettings";
import { TerminalSettings } from "@/components/settings/TerminalSettings";
import { ClaudeCodeSettings } from "@/components/settings/ClaudeCodeSettings";
import { LocalServiceSettings } from "@/components/settings/LocalServiceSettings";
import { DirectorySettings } from "@/components/settings/DirectorySettings";
import { ImportExportSection } from "@/components/settings/ImportExportSection";
import { BackupListSection } from "@/components/settings/BackupListSection";
import { WebdavSyncSection } from "@/components/settings/WebdavSyncSection";
import { AboutSection } from "@/components/settings/AboutSection";
import { ProxyTabContent } from "@/components/settings/ProxyTabContent";
import { ModelTestConfigPanel } from "@/components/usage/ModelTestConfigPanel";
import { UsageDashboard } from "@/components/usage/UsageDashboard";
import { LogConfigPanel } from "@/components/settings/LogConfigPanel";
import { AuthCenterPanel } from "@/components/settings/AuthCenterPanel";
import { useSettings } from "@/hooks/useSettings";
import { useInstalledSkills } from "@/hooks/useSkills";
import { useImportExport } from "@/hooks/useImportExport";
import { isWebRuntime } from "@/lib/runtime/client/env";
import { useTranslation } from "react-i18next";
import type { SettingsFormState } from "@/hooks/useSettings";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportSuccess?: () => void | Promise<void>;
  defaultTab?: string;
}

function SettingsIntroCard({
  eyebrow,
  title,
  description,
  icon,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: ReactNode;
}) {
  return (
    <div className="glass-card rounded-[30px] border border-border-default p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-background/80 shadow-sm">
          {icon}
        </div>
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            {eyebrow}
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
    </div>
  );
}

export function SettingsPage({
  open,
  onOpenChange,
  onImportSuccess,
  defaultTab = "general",
}: SettingsDialogProps) {
  const { t } = useTranslation();
  const isWebMode = isWebRuntime();
  const {
    settings,
    isLoading,
    isSaving,
    appConfigDir,
    resolvedDirs,
    updateSettings,
    updateDirectory,
    updateAppConfigDir,
    browseDirectory,
    browseAppConfigDir,
    resetDirectory,
    resetAppConfigDir,
    saveSettings,
    autoSaveSettings,
    requiresRestart,
    acknowledgeRestart,
  } = useSettings();

  const {
    selectedFile,
    status: importStatus,
    errorMessage,
    backupId,
    isImporting,
    selectImportUpload,
    selectImportFile,
    importConfig,
    exportConfig,
    clearSelection,
    resetStatus,
  } = useImportExport({ onImportSuccess });
  const { data: installedSkills } = useInstalledSkills();

  const [activeTab, setActiveTab] = useState<string>("general");
  const [showRestartPrompt, setShowRestartPrompt] = useState(false);

  useEffect(() => {
    if (open) {
      setActiveTab(defaultTab);
      resetStatus();
    }
  }, [defaultTab, open, resetStatus]);

  useEffect(() => {
    if (requiresRestart) {
      setShowRestartPrompt(true);
    }
  }, [requiresRestart]);

  const closeAfterSave = useCallback(() => {
    // 保存成功后关闭：不再重置语言，避免需要“保存两次”才生效
    acknowledgeRestart();
    clearSelection();
    resetStatus();
    onOpenChange(false);
  }, [acknowledgeRestart, clearSelection, onOpenChange, resetStatus]);

  const handleSave = useCallback(async () => {
    try {
      const result = await saveSettings(undefined, { silent: false });
      if (!result) return;
      if (result.requiresRestart) {
        setShowRestartPrompt(true);
        return;
      }
      closeAfterSave();
    } catch (error) {
      console.error("[SettingsPage] Failed to save settings", error);
    }
  }, [closeAfterSave, saveSettings]);

  const handleRestartLater = useCallback(() => {
    setShowRestartPrompt(false);
    closeAfterSave();
  }, [closeAfterSave]);

  const handleRestartNow = useCallback(async () => {
    setShowRestartPrompt(false);
    toast.info(
      t("settings.webServiceRestartHint", {
        defaultValue: "请手动重启本地 Rust 服务以使配置变更生效",
      }),
      { closeButton: true },
    );
    closeAfterSave();
  }, [closeAfterSave, t]);

  // 通用设置即时保存（无需手动点击）
  // 使用 autoSaveSettings 避免触发需要显式保存的后置流程
  const handleAutoSave = useCallback(
    async (updates: Partial<SettingsFormState>) => {
      if (!settings) return;
      updateSettings(updates);
      try {
        await autoSaveSettings(updates);
      } catch (error) {
        console.error("[SettingsPage] Failed to autosave settings", error);
        toast.error(
          t("settings.saveFailedGeneric", {
            defaultValue: "保存失败，请重试",
          }),
        );
      }
    },
    [autoSaveSettings, settings, t, updateSettings],
  );

  const isBusy = useMemo(() => isLoading && !settings, [isLoading, settings]);

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden px-4 sm:px-6">
      {isBusy ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex flex-col h-full"
        >
          <div className="sticky top-0 z-20 mb-6 bg-gradient-to-b from-background via-background/96 to-transparent pb-4 pt-1 backdrop-blur-xl">
            <div className="glass-card rounded-[30px] border border-border-default p-2 shadow-xl">
              <TabsList className="grid h-auto w-full grid-cols-3 gap-2 bg-transparent p-0 lg:grid-cols-6">
                <TabsTrigger
                  value="general"
                  className="rounded-2xl px-3 py-3 text-sm data-[state=active]:shadow-sm"
                >
                  {t("settings.tabGeneral")}
                </TabsTrigger>
                <TabsTrigger
                  value="proxy"
                  className="rounded-2xl px-3 py-3 text-sm data-[state=active]:shadow-sm"
                >
                  {t("settings.tabProxy")}
                </TabsTrigger>
                <TabsTrigger
                  value="auth"
                  className="rounded-2xl px-3 py-3 text-sm data-[state=active]:shadow-sm"
                >
                  {t("settings.tabAuth", { defaultValue: "认证" })}
                </TabsTrigger>
                <TabsTrigger
                  value="advanced"
                  className="rounded-2xl px-3 py-3 text-sm data-[state=active]:shadow-sm"
                >
                  {t("settings.tabAdvanced")}
                </TabsTrigger>
                <TabsTrigger
                  value="usage"
                  className="rounded-2xl px-3 py-3 text-sm data-[state=active]:shadow-sm"
                >
                  {t("usage.title")}
                </TabsTrigger>
                <TabsTrigger
                  value="about"
                  className="rounded-2xl px-3 py-3 text-sm data-[state=active]:shadow-sm"
                >
                  {t("common.about")}
                </TabsTrigger>
              </TabsList>
            </div>
          </div>

          <div className="flex-1 min-h-0 flex flex-col">
            <div className="scroll-overlay flex-1 overflow-y-auto overflow-x-hidden pr-1 sm:pr-2">
              <TabsContent value="general" className="space-y-6 mt-0">
                {settings ? (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className="space-y-6"
                  >
                    <SettingsIntroCard
                      eyebrow={t("settings.tabGeneral")}
                      title={t("settings.generalIntroTitle", {
                        defaultValue: "统一整理日常高频设置",
                      })}
                      description={t("settings.generalIntroDescription", {
                        defaultValue:
                          "把语言、主题、应用显示范围、本地服务和 Claude Code 相关配置集中在一个区域，方便日常快速调整。",
                      })}
                      icon={<Palette className="h-5 w-5 theme-primary-text" />}
                    />
                    <LanguageSettings
                      value={settings.language}
                      onChange={(lang) => handleAutoSave({ language: lang })}
                    />
                    <ThemeSettings />
                    <AppVisibilitySettings
                      settings={settings}
                      onChange={handleAutoSave}
                    />
                    <SkillStorageLocationSettings
                      value={settings.skillStorageLocation ?? "cc_switch"}
                      installedCount={installedSkills?.length ?? 0}
                      onMigrated={(location) =>
                        updateSettings({ skillStorageLocation: location })
                      }
                    />
                    <SkillSyncMethodSettings
                      value={settings.skillSyncMethod ?? "auto"}
                      onChange={(method) =>
                        handleAutoSave({ skillSyncMethod: method })
                      }
                    />
                    <TerminalSettings
                      value={settings.preferredTerminal}
                      onChange={(terminal) =>
                        handleAutoSave({ preferredTerminal: terminal })
                      }
                    />
                    <LocalServiceSettings
                      launchOnStartup={settings.launchOnStartup ?? false}
                      onLaunchOnStartupChange={(value) =>
                        handleAutoSave({ launchOnStartup: value })
                      }
                    />
                    <ClaudeCodeSettings
                      pluginIntegrationEnabled={
                        settings.enableClaudePluginIntegration ?? false
                      }
                      onPluginIntegrationChange={(value) =>
                        handleAutoSave({
                          enableClaudePluginIntegration: value,
                        })
                      }
                      skipOnboarding={settings.skipClaudeOnboarding ?? false}
                      onSkipOnboardingChange={(value) =>
                        handleAutoSave({ skipClaudeOnboarding: value })
                      }
                    />
                  </motion.div>
                ) : null}
              </TabsContent>

              <TabsContent value="proxy" className="space-y-6 mt-0 pb-4">
                {settings ? (
                  <div className="space-y-6">
                    <SettingsIntroCard
                      eyebrow={t("settings.tabProxy")}
                      title={t("settings.proxyIntroTitle", {
                        defaultValue: "控制代理行为与请求链路",
                      })}
                      description={t("settings.proxyIntroDescription", {
                        defaultValue:
                          "在这里调整代理路由、转发策略和与请求链路相关的核心设置。",
                      })}
                      icon={<Cloud className="h-5 w-5 theme-tertiary-text" />}
                    />
                    <ProxyTabContent
                      settings={settings}
                      onAutoSave={handleAutoSave}
                    />
                  </div>
                ) : null}
              </TabsContent>

              <TabsContent value="auth" className="space-y-6 mt-0 pb-4">
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="space-y-6"
                >
                  <SettingsIntroCard
                    eyebrow={t("settings.tabAuth", { defaultValue: "认证" })}
                    title={t("settings.authCenter.heading", {
                      defaultValue: "认证中心",
                    })}
                    description={t("settings.authCenter.headingDescription", {
                      defaultValue:
                        "统一管理可跨应用复用的 OAuth 账号和默认认证来源。",
                    })}
                    icon={<KeyRound className="h-5 w-5 text-primary" />}
                  />

                  <AuthCenterPanel />
                  {settings ? (
                    <ToggleRow
                      icon={<History className="h-4 w-4 text-sky-500" />}
                      title={t("settings.unifyCodexSessionHistory")}
                      description={t(
                        "settings.unifyCodexSessionHistoryDescription",
                      )}
                      checked={settings.unifyCodexSessionHistory ?? false}
                      onCheckedChange={(value) =>
                        handleAutoSave({ unifyCodexSessionHistory: value })
                      }
                    />
                  ) : null}
                </motion.div>
              </TabsContent>

              <TabsContent value="advanced" className="space-y-6 mt-0 pb-4">
                {settings ? (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className="space-y-6"
                  >
                    <SettingsIntroCard
                      eyebrow={t("settings.tabAdvanced")}
                      title={t("settings.advancedIntroTitle", {
                        defaultValue: "管理数据、目录和高级工具",
                      })}
                      description={t("settings.advancedIntroDescription", {
                        defaultValue:
                          "高级设置聚合了配置目录、导入导出、备份、云同步、日志和模型测试等偏运维能力。",
                      })}
                      icon={
                        <Database className="h-5 w-5 theme-tertiary-text" />
                      }
                    />
                    <Accordion
                      type="multiple"
                      defaultValue={[]}
                      className="w-full space-y-4"
                    >
                      <AccordionItem
                        value="directory"
                        className="rounded-xl glass-card overflow-hidden"
                      >
                        <AccordionTrigger className="px-6 py-4 hover:no-underline hover:bg-muted/50 data-[state=open]:bg-muted/50">
                          <div className="flex items-center gap-3">
                            <FolderSearch className="h-5 w-5 text-primary" />
                            <div className="text-left">
                              <h3 className="text-base font-semibold">
                                {t("settings.advanced.configDir.title")}
                              </h3>
                              <p className="text-sm text-muted-foreground font-normal">
                                {t("settings.advanced.configDir.description")}
                              </p>
                            </div>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-6 pb-6 pt-4 border-t border-border/50">
                          <DirectorySettings
                            showAppConfigDir
                            allowBrowse={!isWebMode}
                            appConfigDir={appConfigDir}
                            resolvedDirs={resolvedDirs}
                            onAppConfigChange={updateAppConfigDir}
                            onBrowseAppConfig={browseAppConfigDir}
                            onResetAppConfig={resetAppConfigDir}
                            claudeDir={settings.claudeConfigDir}
                            codexDir={settings.codexConfigDir}
                            geminiDir={settings.geminiConfigDir}
                            grokDir={settings.grokConfigDir}
                            opencodeDir={settings.opencodeConfigDir}
                            openclawDir={settings.openclawConfigDir}
                            hermesDir={settings.hermesConfigDir}
                            onDirectoryChange={updateDirectory}
                            onBrowseDirectory={browseDirectory}
                            onResetDirectory={resetDirectory}
                          />
                        </AccordionContent>
                      </AccordionItem>

                      <AccordionItem
                        value="data"
                        className="rounded-xl glass-card overflow-hidden"
                      >
                        <AccordionTrigger className="px-6 py-4 hover:no-underline hover:bg-muted/50 data-[state=open]:bg-muted/50">
                          <div className="flex items-center gap-3">
                            <Database className="h-5 w-5 theme-tertiary-text" />
                            <div className="text-left">
                              <h3 className="text-base font-semibold">
                                {t("settings.advanced.data.title")}
                              </h3>
                              <p className="text-sm text-muted-foreground font-normal">
                                {t("settings.advanced.data.description")}
                              </p>
                            </div>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-6 pb-6 pt-4 border-t border-border/50">
                          <ImportExportSection
                            isWebMode={isWebMode}
                            status={importStatus}
                            selectedFile={selectedFile}
                            errorMessage={errorMessage}
                            backupId={backupId}
                            isImporting={isImporting}
                            onSelectUpload={selectImportUpload}
                            onSelectFile={selectImportFile}
                            onImport={importConfig}
                            onExport={exportConfig}
                            onClear={clearSelection}
                          />
                        </AccordionContent>
                      </AccordionItem>

                      <AccordionItem
                        value="backup"
                        className="rounded-xl glass-card overflow-hidden"
                      >
                        <AccordionTrigger className="px-6 py-4 hover:no-underline hover:bg-muted/50 data-[state=open]:bg-muted/50">
                          <div className="flex items-center gap-3">
                            <HardDriveDownload className="h-5 w-5 theme-warning-text" />
                            <div className="text-left">
                              <h3 className="text-base font-semibold">
                                {t("settings.advanced.backup.title", {
                                  defaultValue: "Backup & Restore",
                                })}
                              </h3>
                              <p className="text-sm text-muted-foreground font-normal">
                                {t("settings.advanced.backup.description", {
                                  defaultValue:
                                    "Manage automatic backups, view and restore database snapshots",
                                })}
                              </p>
                            </div>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-6 pb-6 pt-4 border-t border-border/50">
                          <BackupListSection
                            backupIntervalHours={settings.backupIntervalHours}
                            backupRetainCount={settings.backupRetainCount}
                            onSettingsChange={(updates) =>
                              handleAutoSave(updates)
                            }
                          />
                        </AccordionContent>
                      </AccordionItem>

                      <AccordionItem
                        value="cloudSync"
                        className="rounded-xl glass-card overflow-hidden"
                      >
                        <AccordionTrigger className="px-6 py-4 hover:no-underline hover:bg-muted/50 data-[state=open]:bg-muted/50">
                          <div className="flex items-center gap-3">
                            <Cloud className="h-5 w-5 theme-tertiary-text" />
                            <div className="text-left">
                              <h3 className="text-base font-semibold">
                                {t("settings.advanced.cloudSync.title")}
                              </h3>
                              <p className="text-sm text-muted-foreground font-normal">
                                {t("settings.advanced.cloudSync.description")}
                              </p>
                            </div>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-6 pb-6 pt-4 border-t border-border/50">
                          <WebdavSyncSection
                            config={settings?.webdavSync}
                            settings={settings}
                            onAutoSave={handleAutoSave}
                          />
                        </AccordionContent>
                      </AccordionItem>

                      <AccordionItem
                        value="test"
                        className="rounded-xl glass-card overflow-hidden"
                      >
                        <AccordionTrigger className="px-6 py-4 hover:no-underline hover:bg-muted/50 data-[state=open]:bg-muted/50">
                          <div className="flex items-center gap-3">
                            <FlaskConical className="h-5 w-5 theme-success-text" />
                            <div className="text-left">
                              <h3 className="text-base font-semibold">
                                {t("settings.advanced.modelTest.title")}
                              </h3>
                              <p className="text-sm text-muted-foreground font-normal">
                                {t("settings.advanced.modelTest.description")}
                              </p>
                            </div>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-6 pb-6 pt-4 border-t border-border/50">
                          <ModelTestConfigPanel />
                        </AccordionContent>
                      </AccordionItem>

                      <AccordionItem
                        value="logConfig"
                        className="rounded-xl glass-card overflow-hidden"
                      >
                        <AccordionTrigger className="px-6 py-4 hover:no-underline hover:bg-muted/50 data-[state=open]:bg-muted/50">
                          <div className="flex items-center gap-3">
                            <ScrollText className="h-5 w-5 theme-tertiary-text" />
                            <div className="text-left">
                              <h3 className="text-base font-semibold">
                                {t("settings.advanced.logConfig.title")}
                              </h3>
                              <p className="text-sm text-muted-foreground font-normal">
                                {t("settings.advanced.logConfig.description")}
                              </p>
                            </div>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-6 pb-6 pt-4 border-t border-border/50">
                          <LogConfigPanel />
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  </motion.div>
                ) : null}
              </TabsContent>

              <TabsContent value="usage" className="space-y-6 mt-0 pb-4">
                <SettingsIntroCard
                  eyebrow={t("usage.title")}
                  title={t("settings.usageIntroTitle", {
                    defaultValue: "观察请求、额度和数据来源",
                  })}
                  description={t("settings.usageIntroDescription", {
                    defaultValue:
                      "用量面板聚合请求趋势、来源分布、会话同步和各供应商统计，方便持续观察成本与使用状态。",
                  })}
                  icon={<ScrollText className="h-5 w-5 theme-primary-text" />}
                />
                <UsageDashboard />
              </TabsContent>
              <TabsContent value="about" className="space-y-6 mt-0 pb-4">
                <SettingsIntroCard
                  eyebrow={t("common.about")}
                  title={t("settings.aboutIntroTitle", {
                    defaultValue: "版本、更新与项目信息",
                  })}
                  description={t("settings.aboutIntroDescription", {
                    defaultValue:
                      "集中查看当前版本、更新状态、外部链接和项目说明，作为整个应用设置的收口区域。",
                  })}
                  icon={<Save className="h-5 w-5 theme-tertiary-text" />}
                />
                <AboutSection />
              </TabsContent>
            </div>

            {activeTab === "advanced" && settings && (
              <div className="sticky bottom-0 flex-shrink-0 border-t border-border-default bg-background/90 py-4 backdrop-blur-xl">
                <div className="flex items-center justify-end gap-3 px-1 sm:px-2">
                  <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t("settings.saving")}
                      </span>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        {t("common.save")}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Tabs>
      )}

      <Dialog
        open={showRestartPrompt}
        onOpenChange={(open) => !open && handleRestartLater()}
      >
        <DialogContent zIndex="alert" className="max-w-md glass border-border">
          <DialogHeader>
            <DialogTitle>{t("settings.restartRequired")}</DialogTitle>
          </DialogHeader>
          <div className="px-6">
            <p className="text-sm text-muted-foreground">
              {isWebMode
                ? t("settings.webServiceRestartMessage", {
                    defaultValue:
                      "部分改动需要重新启动本地服务后才能完全生效。你可以稍后手动重启本地 Rust 服务。",
                  })
                : t("settings.restartRequiredMessage")}
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={handleRestartLater}
              className="hover:bg-muted/50"
            >
              {t("settings.restartLater")}
            </Button>
            <Button
              onClick={handleRestartNow}
              className="bg-primary hover:bg-primary/90"
            >
              {isWebMode
                ? t("settings.webServiceRestartAcknowledge", {
                    defaultValue: "我稍后手动重启",
                  })
                : t("settings.restartNow")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
