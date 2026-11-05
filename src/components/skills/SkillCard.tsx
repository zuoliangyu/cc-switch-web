import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Download, Trash2, Loader2 } from "lucide-react";
import { settingsApi } from "@/lib/api";
import type { DiscoverableSkill } from "@/lib/api/skills";

type SkillCardSkill = DiscoverableSkill & { installed: boolean };

interface SkillCardProps {
  skill: SkillCardSkill;
  onInstall: (directory: string) => Promise<void>;
  onUninstall: (directory: string) => Promise<void>;
  installs?: number;
}

export function SkillCard({
  skill,
  onInstall,
  onUninstall,
  installs,
}: SkillCardProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  const handleInstall = async () => {
    setLoading(true);
    try {
      await onInstall(skill.directory);
    } finally {
      setLoading(false);
    }
  };

  const handleUninstall = async () => {
    setLoading(true);
    try {
      await onUninstall(skill.directory);
    } finally {
      setLoading(false);
    }
  };

  // 文档地址：优先 SKILL.md 所在目录，缺省回落到仓库首页（和已安装列表一致）
  const docsUrl =
    skill.readmeUrl ??
    (skill.repoOwner && skill.repoName
      ? `https://github.com/${skill.repoOwner}/${skill.repoName}`
      : undefined);

  const handleOpenGithub = async () => {
    if (docsUrl) {
      try {
        await settingsApi.openExternal(docsUrl);
      } catch (error) {
        console.error("Failed to open URL:", error);
      }
    }
  };

  const showDirectory =
    Boolean(skill.directory) &&
    skill.directory.trim().toLowerCase() !== skill.name.trim().toLowerCase();

  return (
    <Card className="glass-card group relative flex h-full flex-col overflow-hidden rounded-[26px] border border-border-default transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-tertiary/8 opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
      <CardHeader className="space-y-4 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="theme-chip-neutral inline-flex max-w-full items-center rounded-full px-3 py-1 text-[11px] font-medium">
                {showDirectory ? skill.directory : skill.name}
              </span>
              {typeof installs === "number" && (
                <Badge
                  variant="secondary"
                  className="h-6 shrink-0 gap-1 rounded-full px-2.5 text-[11px]"
                >
                  <Download className="h-3 w-3" />
                  {installs.toLocaleString()}
                </Badge>
              )}
            </div>
            <CardTitle className="mt-3 text-lg font-semibold tracking-tight text-foreground">
              {skill.name}
            </CardTitle>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {skill.repoOwner && skill.repoName && (
                <Badge
                  variant="outline"
                  className="max-w-full shrink-0 rounded-full border-border-default px-2.5 py-1 text-[11px]"
                >
                  <span className="truncate">
                    {skill.repoOwner}/{skill.repoName}
                  </span>
                </Badge>
              )}
              {skill.repoBranch ? (
                <Badge
                  variant="outline"
                  className="shrink-0 rounded-full border-border-default px-2.5 py-1 text-[11px]"
                >
                  {skill.repoBranch}
                </Badge>
              ) : null}
            </div>
          </div>
          {skill.installed && (
            <Badge
              variant="default"
              className="theme-success-solid shrink-0 rounded-full border-0 px-3 py-1 text-[11px]"
            >
              {t("skills.installed")}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="relative z-10 flex-1 space-y-4 pt-0">
        <p className="line-clamp-4 text-sm leading-7 text-muted-foreground/90">
          {skill.description || t("skills.noDescription")}
        </p>
        {showDirectory && (
          <div className="rounded-2xl border border-border/50 bg-background/60 px-3 py-2">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {t("common.path", { defaultValue: "路径" })}
            </div>
            <CardDescription className="mt-1 break-all text-xs leading-5 text-muted-foreground">
              {skill.directory}
            </CardDescription>
          </div>
        )}
      </CardContent>
      <CardFooter className="relative z-10 mt-4 flex gap-2 border-t border-border/50 pt-4">
        {docsUrl && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleOpenGithub}
            disabled={loading}
            className="flex-1 rounded-xl"
          >
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
            {t("skills.view")}
          </Button>
        )}
        {skill.installed ? (
          <Button
            variant="outline"
            size="sm"
            onClick={handleUninstall}
            disabled={loading}
            className="flex-1 rounded-xl border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/50 dark:hover:text-red-300"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            )}
            {loading ? t("skills.uninstalling") : t("skills.uninstall")}
          </Button>
        ) : (
          <Button
            variant="mcp"
            size="sm"
            onClick={handleInstall}
            disabled={loading || !skill.repoOwner}
            className="flex-1 rounded-xl"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5 mr-1.5" />
            )}
            {loading ? t("skills.installing") : t("skills.install")}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
