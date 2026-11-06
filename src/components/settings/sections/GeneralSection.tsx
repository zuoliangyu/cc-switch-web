import { useTranslation } from "react-i18next";
import { ChevronRight, Monitor, Moon, Sun } from "lucide-react";
import type { SettingsFormState } from "@/hooks/useSettings";
import { useTheme } from "@/components/theme-provider";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { TerminalSelect } from "@/components/settings/TerminalSettings";
import { ThemePaletteControl } from "@/components/settings/ThemeSettings";
import { ModelTestConfigPanel } from "@/components/usage/ModelTestConfigPanel";
import {
  SettingsBlock,
  SettingsCard,
  SettingsRow,
  SettingsSwitchRow,
} from "@/components/settings/SettingsLayout";

type Language = SettingsFormState["language"];

// Web 只提供中、英、日三种界面语言
const LANGUAGES: { value: Language; labelKey: string }[] = [
  { value: "zh", labelKey: "settings.languageOptionChinese" },
  { value: "en", labelKey: "settings.languageOptionEnglish" },
  { value: "ja", labelKey: "settings.languageOptionJapanese" },
];

interface GeneralSectionProps {
  settings: SettingsFormState;
  onAutoSave: (updates: Partial<SettingsFormState>) => Promise<boolean>;
  onOpenApps: () => void;
}

/**
 * 设置 → 通用（上游 v7）：外观、侧栏与页头、启动与终端。
 * 托盘、窗口、开机静默启动与各应用新版本检查是桌面端的，Web 不提供；
 * 「本地服务开机自启」与「模型测试」是 Web 自己的设置，放在这一节。
 */
export function GeneralSection({
  settings,
  onAutoSave,
  onOpenApps,
}: GeneralSectionProps) {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  return (
    <>
      <SettingsBlock title={t("settings.general.appearance")}>
        <SettingsCard>
          <SettingsRow
            label={t("settings.language")}
            control={
              <Select
                value={settings.language}
                onValueChange={(value) =>
                  void onAutoSave({ language: value as Language })
                }
              >
                <SelectTrigger
                  className="h-8 w-[160px]"
                  aria-label={t("settings.language")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((language) => (
                    <SelectItem key={language.value} value={language.value}>
                      {t(language.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
          <SettingsRow
            label={t("settings.theme")}
            control={
              <SegmentedControl
                size="sm"
                aria-label={t("settings.theme")}
                value={theme}
                onValueChange={(value) => setTheme(value)}
                items={[
                  {
                    value: "system",
                    label: (
                      <span className="inline-flex items-center gap-1.5">
                        <Monitor className="h-3.5 w-3.5" />
                        {t("settings.themeSystem")}
                      </span>
                    ),
                  },
                  {
                    value: "light",
                    label: (
                      <span className="inline-flex items-center gap-1.5">
                        <Sun className="h-3.5 w-3.5" />
                        {t("settings.themeLight")}
                      </span>
                    ),
                  },
                  {
                    value: "dark",
                    label: (
                      <span className="inline-flex items-center gap-1.5">
                        <Moon className="h-3.5 w-3.5" />
                        {t("settings.themeDark")}
                      </span>
                    ),
                  },
                ]}
              />
            }
          />
          <SettingsRow
            label={t("settings.themePalette")}
            help={{
              title: t("settings.themePalette"),
              body: t("settings.themePaletteHint"),
            }}
            control={<ThemePaletteControl />}
          />
          <SettingsRow
            label={t("settings.general.quotaDisplay")}
            help={{
              title: t("settings.general.quotaDisplay"),
              body: t("settings.general.quotaDisplayHelp"),
            }}
            control={
              <SegmentedControl
                size="sm"
                aria-label={t("settings.general.quotaDisplay")}
                value={settings.quotaDisplay ?? "left"}
                onValueChange={(value) =>
                  void onAutoSave({ quotaDisplay: value })
                }
                items={[
                  {
                    value: "left",
                    label: t("settings.general.quotaDisplayLeft"),
                  },
                  {
                    value: "used",
                    label: t("settings.general.quotaDisplayUsed"),
                  },
                ]}
              />
            }
          />
        </SettingsCard>
      </SettingsBlock>

      <SettingsBlock title={t("settings.general.sidebarAndHeader")}>
        <SettingsCard>
          <SettingsRow
            label={t("settings.general.visibleApps")}
            control={
              <Button variant="ghost" size="sm" onClick={onOpenApps}>
                {t("settings.general.goToApps")}
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            }
          />
          <SettingsSwitchRow
            label={t("settings.appVisibility.showProfileSwitcher")}
            help={{
              title: t("settings.appVisibility.showProfileSwitcher"),
              body: t("settings.appVisibility.showProfileSwitcherDescription"),
            }}
            checked={settings.showProfileSwitcher ?? false}
            onCheckedChange={(value) =>
              void onAutoSave({ showProfileSwitcher: value })
            }
          />
          <SettingsSwitchRow
            label={t("settings.appVisibility.showProviderSearch")}
            help={{
              title: t("settings.appVisibility.showProviderSearch"),
              body: t("settings.appVisibility.showProviderSearchDescription"),
            }}
            checked={settings.showProviderSearch ?? true}
            onCheckedChange={(value) =>
              void onAutoSave({ showProviderSearch: value })
            }
          />
        </SettingsCard>
      </SettingsBlock>

      <SettingsBlock title={t("settings.general.startupAndTerminal")}>
        <SettingsCard>
          <SettingsSwitchRow
            label={t("settings.launchOnStartup")}
            help={{
              title: t("settings.launchOnStartup"),
              body: t("settings.launchOnStartupDescription"),
            }}
            checked={!!settings.launchOnStartup}
            onCheckedChange={(value) =>
              void onAutoSave({ launchOnStartup: value })
            }
          />
          <SettingsRow
            label={t("settings.terminal.title")}
            help={{
              title: t("settings.terminal.title"),
              body: t("settings.general.terminalHelp"),
            }}
            control={
              <TerminalSelect
                className="h-8 w-[160px]"
                value={settings.preferredTerminal}
                onChange={(terminal) =>
                  void onAutoSave({ preferredTerminal: terminal })
                }
              />
            }
          />
        </SettingsCard>
      </SettingsBlock>

      <SettingsBlock
        id="settings-model-test"
        title={t("settings.advanced.modelTest.title")}
        help={{
          title: t("settings.advanced.modelTest.title"),
          body: t("settings.advanced.modelTest.description"),
        }}
      >
        <div className="rounded-xl border border-border bg-card p-5">
          <ModelTestConfigPanel />
        </div>
      </SettingsBlock>
    </>
  );
}
