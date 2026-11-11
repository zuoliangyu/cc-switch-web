import type { ReactNode } from "react";
import { Construction, ExternalLink, Layers3, Route } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useHermesLiveProviderIds,
  useHermesModelConfig,
} from "@/hooks/useHermes";
import { ProviderIcon } from "@/components/ProviderIcon";
import { Button } from "@/components/ui/button";

interface HermesPlaceholderPanelProps {
  onOpenWebUI: () => void | Promise<void>;
}

export function HermesPlaceholderPanel({
  onOpenWebUI,
}: HermesPlaceholderPanelProps) {
  const { t } = useTranslation();
  const { data: modelConfig } = useHermesModelConfig(true);
  const { data: liveProviderIds = [] } = useHermesLiveProviderIds(true);

  return (
    <div className="px-6 pt-4">
      <div className="glass-card rounded-[28px] border border-border-default p-6 sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/80">
                <ProviderIcon icon="hermes" name="Hermes" size={24} />
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Hermes
                </div>
                <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                  {t("hermes.placeholderTitle", {
                    defaultValue: "Hermes 基础骨架已接入",
                  })}
                </h2>
              </div>
            </div>

            <p className="text-sm leading-6 text-muted-foreground">
              {t("hermes.placeholderDescription", {
                defaultValue:
                  "这一笔先把 Hermes 作为第 6 个应用接入主工作台，并补齐可见性与切换入口。Provider、Memory、Session 等专属能力会在后续提交继续补齐。",
              })}
            </p>

            <div className="flex flex-wrap gap-3">
              <Button type="button" onClick={() => void onOpenWebUI()}>
                <ExternalLink className="mr-2 h-4 w-4" />
                {t("hermes.webui.open")}
              </Button>
            </div>

            <div className="rounded-3xl border border-border-default bg-background/70 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {t("hermes.summary.title")}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t("hermes.summary.description")}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {t("hermes.summary.source")}
                </span>
              </div>
              {modelConfig ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <SummaryItem
                    label={t("hermes.summary.provider")}
                    value={modelConfig.provider}
                  />
                  <SummaryItem
                    label={t("hermes.summary.defaultModel")}
                    value={modelConfig.default}
                  />
                  <SummaryItem
                    label={t("hermes.summary.baseUrl")}
                    value={modelConfig.baseUrl}
                  />
                  <SummaryItem
                    label={t("hermes.summary.contextLength")}
                    value={
                      modelConfig.contextLength !== undefined
                        ? String(modelConfig.contextLength)
                        : undefined
                    }
                  />
                  <SummaryItem
                    label={t("hermes.summary.maxTokens")}
                    value={
                      modelConfig.maxTokens !== undefined
                        ? String(modelConfig.maxTokens)
                        : undefined
                    }
                  />
                </div>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">
                  {t("hermes.summary.empty")}
                </p>
              )}
            </div>

            <div className="rounded-3xl border border-border-default bg-background/70 p-5">
              <div className="text-sm font-medium text-foreground">
                {t("hermes.liveProviders.title")}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("hermes.liveProviders.description")}
              </p>
              {liveProviderIds.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {liveProviderIds.map((providerId: string) => (
                    <span
                      key={providerId}
                      className="rounded-full border border-border-default bg-background/75 px-3 py-1 text-xs font-medium text-foreground"
                    >
                      {providerId}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">
                  {t("hermes.liveProviders.empty")}
                </p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <StatusCard
                icon={<Layers3 className="h-4 w-4" />}
                title={t("hermes.placeholderStatus.appsTitle", {
                  defaultValue: "应用骨架",
                })}
                description={t("hermes.placeholderStatus.appsDescription", {
                  defaultValue: "已支持 Hermes 应用展示、切换和可见性控制。",
                })}
              />
              <StatusCard
                icon={<Route className="h-4 w-4" />}
                title={t("hermes.placeholderStatus.flowTitle", {
                  defaultValue: "流程保护",
                })}
                description={t("hermes.placeholderStatus.flowDescription", {
                  defaultValue:
                    "当前会停在占位页，避免误走现有 Provider 链路。",
                })}
              />
              <StatusCard
                icon={<Construction className="h-4 w-4" />}
                title={t("hermes.placeholderStatus.nextTitle", {
                  defaultValue: "后续接入",
                })}
                description={t("hermes.placeholderStatus.nextDescription", {
                  defaultValue:
                    "下一步将继续补 Hermes Provider、Memory 和 Session。",
                })}
              />
            </div>
          </div>

          <div className="w-full max-w-sm rounded-3xl border border-dashed border-border-default bg-background/70 p-5">
            <div className="text-sm font-medium text-foreground">
              {t("hermes.placeholderChecklistTitle", {
                defaultValue: "本阶段已完成",
              })}
            </div>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li>
                {t("hermes.placeholderChecklist.switcher", {
                  defaultValue: "主界面 App Switcher 已出现 Hermes。",
                })}
              </li>
              <li>
                {t("hermes.placeholderChecklist.visibility", {
                  defaultValue: "设置页可控制 Hermes 的显示与隐藏。",
                })}
              </li>
              <li>
                {t("hermes.placeholderChecklist.guard", {
                  defaultValue:
                    "切到 Hermes 时不会误触发未完成的 Provider 操作。",
                })}
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusCard({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-border-default bg-background/75 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        {icon}
        <span>{title}</span>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-2xl border border-border-default bg-background/75 p-4">
      <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 break-all text-sm font-medium text-foreground">
        {value && value.trim().length > 0 ? value : "—"}
      </div>
    </div>
  );
}
