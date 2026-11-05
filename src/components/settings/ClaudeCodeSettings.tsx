import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ToggleRow } from "@/components/ui/toggle-row";

interface ClaudeCodeSettingsProps {
  pluginIntegrationEnabled: boolean;
  onPluginIntegrationChange: (value: boolean) => void;
  skipOnboarding: boolean;
  onSkipOnboardingChange: (value: boolean) => void;
}

export function ClaudeCodeSettings({
  pluginIntegrationEnabled,
  onPluginIntegrationChange,
  skipOnboarding,
  onSkipOnboardingChange,
}: ClaudeCodeSettingsProps) {
  const { t } = useTranslation();

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 border-b border-border/40 pb-2">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <div className="space-y-1">
          <h3 className="text-sm font-medium">{t("settings.claudeCode")}</h3>
          <p className="text-xs text-muted-foreground">
            {t("settings.claudeCodeHint")}
          </p>
        </div>
      </div>

      <ToggleRow
        icon={<ShieldCheck className="h-4 w-4 text-sky-500" />}
        title={t("settings.enableClaudePluginIntegration")}
        description={t("settings.enableClaudePluginIntegrationDescription")}
        checked={pluginIntegrationEnabled}
        onCheckedChange={onPluginIntegrationChange}
      />

      <ToggleRow
        icon={<ShieldCheck className="h-4 w-4 text-emerald-500" />}
        title={t("settings.skipClaudeOnboarding")}
        help={t("settings.skipClaudeOnboardingDescription")}
        checked={skipOnboarding}
        onCheckedChange={onSkipOnboardingChange}
      />
    </section>
  );
}
